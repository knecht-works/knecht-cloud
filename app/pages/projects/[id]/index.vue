<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { useRoute, navigateTo } from '#app'
import { useProject } from '~/composables/useProjects'
import { useRuns } from '~/composables/useRuns'
import { computed, ref, onMounted, watch } from 'vue'
import { groupRunsBySession, runStatusMeta, DOT_COLOR_VAR, triggerMeta } from '~/utils/dashboard'
import { $fetch } from '#build/fetch.mjs'
import { useWorkflows, useTriggers } from '~/composables/useWorkflows'
import { workflowRunnable } from '~/utils/workflow-steps'
import { useStartRun } from '~/composables/useStartRun'
import { invalidate } from '~/composables/useLiveTopics'

const route = useRoute()
const id = Number(route.params.id)

const { data: project } = await useProject(id)
const { data: runs } = await useRuns(id)

const projectRuns = computed(() => runs.value ?? [])
const latest = computed(() => projectRuns.value[0] ?? null)

const sessionGroups = computed(() => groupRunsBySession(projectRuns.value))

// The selection is a ref, not a computed from the query, so a new run appearing
// changes the list but never what the workspace shows.
const offListRun = ref<(typeof projectRuns.value)[number] | null>(null)
const queryRun = Number(route.query.run)
if (Number.isInteger(queryRun) && !projectRuns.value.some(r => r.id === queryRun)) {
  const fetched = await $fetch(`/api/runs/${queryRun}`).catch(() => null)
  if (fetched && fetched.projectId === id) {
    const { steps, ...row } = fetched
    offListRun.value = row
  }
}

// Old links name a run (they sit in published PR bodies and agent comments); they open its session.
function sessionFromQuery(): number | null {
  const s = Number(route.query.session)
  if (sessionGroups.value.some(g => g.sessionId === s) || offListRun.value?.sessionId === s) return s
  const r = Number(route.query.run)
  return projectRuns.value.find(run => run.id === r)?.sessionId
    ?? (offListRun.value && offListRun.value.id === r ? offListRun.value.sessionId : null)
}

const selectedSessionId = ref<number | null>(sessionFromQuery() ?? latest.value?.sessionId ?? null)
const selectedGroup = computed(() =>
  sessionGroups.value.find(g => g.sessionId === selectedSessionId.value)
  ?? (offListRun.value?.sessionId === selectedSessionId.value
    ? { sessionId: offListRun.value.sessionId, objects: offListRun.value.objects, runs: [offListRun.value] }
    : null))
const selectedRun = computed(() => selectedGroup.value?.runs[0] ?? null)

function selectSession(sessionId: number) {
  navigateTo({ query: { ...route.query, run: undefined, session: String(sessionId) } }, { replace: true })
}

function syncQuery() {
  const q = sessionFromQuery()
  if (route.query.run && q !== null) selectSession(q)
  else if ((route.query.run || route.query.session) && q === null)
    navigateTo({ query: { ...route.query, run: undefined, session: undefined } }, { replace: true })
}

onMounted(syncQuery)

watch(() => [route.query.session, route.query.run], () => {
  const q = sessionFromQuery()
  if (q !== null) selectedSessionId.value = q
  if (q !== null && q === latest.value?.sessionId) lastSeenLatestId.value = latest.value.id
  syncQuery()
})

const lastSeenLatestId = ref(latest.value?.id ?? null)
const newRun = computed(() =>
  latest.value && latest.value.sessionId !== selectedSessionId.value && latest.value.id !== lastSeenLatestId.value
    ? latest.value
    : null)

watch(runs, () => {
  if (selectedSessionId.value === offListRun.value?.sessionId) return
  if (selectedSessionId.value !== null && !sessionGroups.value.some(g => g.sessionId === selectedSessionId.value)) {
    selectedSessionId.value = latest.value?.sessionId ?? null
    lastSeenLatestId.value = latest.value?.id ?? null
    navigateTo({ query: { ...route.query, run: undefined, session: undefined } }, { replace: true })
  }
})

const statusMeta = computed(() => runStatusMeta(selectedRun.value))
const statusColor = computed(() => DOT_COLOR_VAR[statusMeta.value.dot])

const mascotLine = computed(() => {
  const r = selectedRun.value
  if (!r) return 'No runs yet. Start a workflow to boot this project.'
  if (r.status === 'running' || r.status === 'queued') return `Working on ${r.workflow} right now.`
  if (r.status === 'failed') {
    if (r.failureDiagnosis?.state === 'pending') return 'Knecht is looking into why the last run failed.'
    return r.failureDiagnosis?.summary ?? 'The last run failed. Open it to see why.'
  }
  if (!r.hasEnv) return 'This session has code only. Start a preview from the run menu to boot it.'
  if (r.envTransition === 'stopping') return 'The environment is shutting down.'
  if (r.envTransition === 'rebooting') return 'The environment is booting again. The preview is back in a moment.'
  if (r.envTransition === 'restoring') return 'The environment is being restored from its archive. This takes a few minutes.'
  if (r.envTransition === 'archiving') return 'The environment is being archived.'
  if (r.envState === 'up') return r.hasPreviewTarget ? 'The preview is live and ready to inspect.' : 'The environment is up. Open the terminal or the IDE to work in it.'
  if (r.envState === 'stopped') return 'The environment is stopped. Reboot it from the run menu or send a follow-up to wake it.'
  if (r.envState === 'archived') return 'The environment is archived. Restore it from the run menu to work in it again.'
  return 'The environment is gone. Run the workflow again for a fresh one.'
})

const diagnosis = computed(() => selectedRun.value?.status === 'failed' ? selectedRun.value.failureDiagnosis : null)

const { data: workflowList } = useWorkflows()
const startableWorkflows = computed(() => (workflowList.value ?? []).filter(workflowRunnable))
const { starting, start: startRun } = useStartRun(id, onRunStarted)
const startWorkflow = (workflowId: number) => startRun(workflowId, project.value?.defaultBranch ?? 'main')

async function onRunStarted(runId: number) {
  await invalidate(liveTopics.runs)
  lastSeenLatestId.value = runId
  await navigateTo({ query: { ...route.query, session: undefined, run: String(runId) } }, { replace: true })
}

async function onRunDeleted() {
  if (offListRun.value?.id === selectedRun.value?.id) offListRun.value = null
  await invalidate(liveTopics.runs)
}

const { data: triggers } = useTriggers()
const projectTriggers = computed(() =>
  (triggers.value ?? []).filter(t => t.projectIds.includes(id)))

const workflowRows = computed(() => startableWorkflows.value.flatMap((w) => {
  const [trigger, ...rest] = projectTriggers.value.filter(t => t.workflowId === w.id)
  return trigger ? [{ id: w.id, name: w.name, trigger, more: rest.length }] : []
}))
</script>

<template>
  <div v-if="project">
    <KProjectHeader
      class="mb-6"
      :project="project"
      @run-started="onRunStarted"
    >
      <template #breadcrumb>
        <UBreadcrumb :items="[{ label: 'Projects', to: '/projects' }, { label: project.fullName }]">
          <template #separator>
            <span class="k-mono text-xs text-dimmed">/</span>
          </template>
        </UBreadcrumb>
      </template>
    </KProjectHeader>

    <!-- Sidebar sizing matches workflows/[id].vue, keep them in sync. -->
    <div class="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[1fr_clamp(340px,26vw,560px)]">
      <div class="min-w-0">
        <KProjectHero
          class="mb-3"
          :project="project"
        />
        <KRunWorkspace
          v-if="selectedRun"
          :key="selectedRun.id"
          :run-id="selectedRun.id"
          :session-id="selectedRun.sessionId"
          :session-runs="selectedGroup!.runs"
          @deleted="onRunDeleted"
          @started="onRunStarted"
          @changed="invalidate(liveTopics.runs)"
        />
        <KPreviewBrowser
          v-else
          :session-id="0"
          :online="false"
        >
          <img
            src="/mascot/mascotRight.png"
            alt="Knecht"
            class="h-16 w-auto drop-shadow-mascot"
          >
          <p class="max-w-70 text-2sm text-muted">
            No live preview yet. Start a workflow to boot the project, then preview it here.
          </p>
        </KPreviewBrowser>
      </div>

      <div class="flex flex-col gap-4.5">
        <div
          class="k-card overflow-hidden"
          :style="{ borderColor: `color-mix(in oklab, ${statusColor} 30%, transparent)` }"
        >
          <div
            class="flex items-center gap-3.5 px-5 py-4.5"
            :style="{ background: `linear-gradient(90deg, color-mix(in oklab, ${statusColor} 8%, transparent), transparent)` }"
          >
            <img
              src="/mascot/mascotRight.png"
              alt="Knecht"
              class="h-13 w-auto flex-none drop-shadow-mascot"
            >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <KStatusDot
                  :color="statusMeta.dot"
                  :pulse="statusMeta.pulse"
                  :size="6"
                />
                <span
                  class="k-mono text-2xs uppercase tracking-widest"
                  :style="{ color: statusMeta.text }"
                >{{ statusMeta.label }}</span>
              </div>
              <p class="mt-1.5 text-2sm leading-snug text-toned">
                <UIcon
                  v-if="diagnosis?.state === 'pending'"
                  name="i-lucide-loader-circle"
                  class="mr-1 inline-block size-3 animate-spin motion-reduce:animate-none align-[-1px] text-dimmed"
                />{{ mascotLine }}
              </p>
              <div
                v-if="diagnosis?.state === 'done' && diagnosis.steps.length && selectedRun?.workflowId"
                class="mt-2 flex flex-wrap gap-1.5"
              >
                <NuxtLink
                  v-for="s in diagnosis.steps"
                  :key="s.id"
                  :to="{ path: `/workflows/${selectedRun.workflowId}`, query: { step: s.stepId } }"
                  class="k-mono inline-flex cursor-pointer items-center gap-1 rounded-md border border-muted px-1.5 py-0.5 text-2xs text-muted transition-colors hover:bg-elevated/50 hover:text-highlighted"
                >
                  <UIcon
                    name="i-lucide-corner-down-right"
                    class="size-3"
                  />{{ s.label }}
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <KPanel
          title="Sessions"
          icon="i-lucide-messages-square"
          :pad="0"
        >
          <template #action>
            <button
              v-if="newRun"
              type="button"
              class="k-mono flex cursor-pointer items-center gap-1.5 text-2xs text-primary transition-colors hover:text-highlighted"
              @click="selectSession(newRun.sessionId)"
            >
              <KStatusDot
                color="primary"
                pulse
                :size="5"
              />
              New run #{{ newRun.id }}
            </button>
            <span
              v-else
              class="text-xs tabular-nums text-dimmed"
            >{{ sessionGroups.length }} {{ sessionGroups.length === 1 ? 'session' : 'sessions' }}</span>
          </template>

          <div
            v-if="!projectRuns.length"
            class="flex flex-col items-center gap-3 px-5 py-10 text-center"
          >
            <UIcon
              name="i-lucide-play"
              class="size-7 text-dimmed"
            />
            <p class="text-2sm text-muted">
              No runs yet. Start a workflow to boot this project.
            </p>
          </div>
          <div class="@container">
            <div class="max-h-100 overflow-y-auto">
              <KSessionList
                :groups="sessionGroups"
                :session-to="g => ({ query: { session: String(g.sessionId) } })"
                replace
                :selected-session-id="selectedSessionId"
                hide-runs
              />
            </div>
          </div>
        </KPanel>

        <KPanel
          title="Automation"
          icon="i-lucide-zap"
          accent="var(--accent-violet)"
        >
          <p
            v-if="!workflowRows.length"
            class="text-2sm text-muted"
          >
            No workflow is triggered by this project.
          </p>
          <div
            v-else
            class="flex flex-col gap-3"
          >
            <div
              v-for="row in workflowRows"
              :key="row.id"
              class="flex items-center gap-3"
              :style="{ opacity: row.trigger.active ? 1 : 0.55 }"
            >
              <NuxtLink
                :to="`/workflows/${row.id}`"
                class="group flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <KStepIcon
                  :icon="triggerMeta(row.trigger).icon"
                  :color="triggerMeta(row.trigger).color"
                  :size="28"
                  :radius="7"
                />
                <span class="min-w-0 flex-1">
                  <span class="k-mono block truncate text-xs text-default transition-colors group-hover:text-highlighted">
                    {{ row.name }}
                  </span>
                  <span class="k-mono block truncate text-2xs text-dimmed">
                    {{ row.trigger.event }} · {{ triggerMeta(row.trigger).label }}<template v-if="row.more > 0"> · +{{ row.more }}</template>
                  </span>
                </span>
              </NuxtLink>
              <UTooltip :text="`Run ${row.name} on this project now`">
                <UButton
                  icon="i-lucide-play"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Run ${row.name} now`"
                  :disabled="starting"
                  @click="startWorkflow(row.id)"
                />
              </UTooltip>
            </div>
          </div>
        </KPanel>
      </div>
    </div>
  </div>
</template>
