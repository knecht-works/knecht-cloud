<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { previewHostname } from '#shared/utils/preview-host'
import { formatDatabase, formatPackageManager, projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { useRoute, useRequestURL, navigateTo } from '#imports'
import { useProject } from '~/composables/useProjects'
import { useRuns, useRunStatsBy } from '~/composables/useRuns'
import { computed } from 'vue'
import { groupRunsBySession, projectStatusMeta, sessionObjectMeta, sessionTitle, sessionTicket, sessionBranch, sessionPr, sessionStatusLine, frameworkMeta, timeAgo, triggerMeta } from '~/utils/dashboard'
import { useWorkflows, useTriggers } from '~/composables/useWorkflows'
import { workflowRunnable } from '~/utils/workflow-steps'
import { useStartRun } from '~/composables/useStartRun'
import { invalidate } from '~/composables/useLiveTopics'
import KPanel from '~/components/KPanel.vue'
import KSessionList from '~/components/KSessionList.vue'
import KStatusBadge from '~/components/KStatusBadge.vue'
import KRunSparkline from '~/components/KRunSparkline.vue'
import KRunStatsText from '~/components/KRunStatsText.vue'
import KStepIcon from '~/components/KStepIcon.vue'
import { UIcon, NuxtLink, UButton, UTooltip } from '#components'

const route = useRoute()
const id = Number(route.params.id)
const sessionsPath = `/projects/${id}/sessions`

// Links from before the Sessions tab sit in published PR bodies and agent comments.
if (route.query.run || route.query.session) {
  await navigateTo({ path: sessionsPath, query: route.query }, { replace: true })
}

const { data: project } = await useProject(id)
const { data: runs } = await useRuns(id)

const sessionGroups = computed(() => groupRunsBySession(runs.value ?? []))
const sessionTo = (g: { sessionId: number }) => ({ path: sessionsPath, query: { session: String(g.sessionId) } })

const latestGroup = computed(() => sessionGroups.value[0] ?? null)
const latest = computed(() => latestGroup.value?.runs[0] ?? null)
const otherGroups = computed(() => sessionGroups.value.slice(1))

const latestDiagnosis = computed(() => latest.value?.status === 'failed' ? latest.value.failureDiagnosis : null)
const latestTicket = computed(() => {
  const o = latestGroup.value && sessionTicket(latestGroup.value)
  return o ? { ...o, meta: sessionObjectMeta(o.integration, o.kind) } : null
})
const latestFacts = computed(() => {
  const g = latestGroup.value
  if (!g) return []
  const pr = sessionPr(g)
  return [
    { label: 'Workflow', text: g.runs[0]!.workflow },
    { label: 'Branch', text: sessionBranch(g) },
    { label: 'Pull request', text: pr?.label, href: pr?.url },
    { label: 'Last run', text: timeAgo(g.runs[0]!.createdAt) },
  ].filter(f => f.text)
})

const reqUrl = useRequestURL()
const previewUrl = computed(() => {
  const r = latest.value
  return r && r.envState === 'up' && r.previewReady && !r.envTransition
    ? `${reqUrl.protocol}//${previewHostname(r.sessionId, reqUrl.host)}/`
    : null
})

const statsByProject = useRunStatsBy('projectId')
const stats = computed(() => statsByProject.value.get(id))

const environmentFacts = computed(() => {
  const p = project.value
  if (!p) return []
  const fw = frameworkMeta(p.framework).label
  const e = p.ddevEnv
  const env = resolveEnv(projectDetectedEnv(e), p)
  const ddev = env.source === 'ddev'
  return [
    { label: 'Framework', text: p.frameworkVersion ? `${fw} ${p.frameworkVersion}` : fw },
    { label: 'Default branch', text: p.defaultBranch },
    { label: 'Web', text: ddev ? e?.webserver?.replace(/-fpm$/, '') : null },
    { label: 'PHP', text: ddev ? e?.phpVersion : env.phpVersion.value },
    { label: 'Database', text: ddev ? e?.dbType && `${e.dbType}${e.dbVersion ? ` ${e.dbVersion}` : ''}` : env.database.value && formatDatabase(env.database.value) },
    { label: 'Node', text: ddev ? e?.nodeVersion : env.nodeVersion.value },
    { label: 'Package manager', text: env.packageManager.source === 'default' ? null : formatPackageManager(env.packageManager.value) },
  ].filter(f => f.text)
})

const { data: workflowList } = useWorkflows()
const { data: triggers } = useTriggers()
// A schedule or manual trigger needs no object, so its workflow can be started right here.
const startsDirectly = (t: { source: string }) => t.source === 'schedule' || t.source === 'manual'
const workflowRows = computed(() => (workflowList.value ?? []).filter(workflowRunnable).flatMap((w) => {
  const own = (triggers.value ?? []).filter(t => t.projectIds.includes(id) && t.workflowId === w.id)
  const trigger = own.find(startsDirectly) ?? own[0]
  return trigger ? [{ id: w.id, name: w.name, trigger, more: own.length - 1, direct: startsDirectly(trigger), paused: !w.enabled || !trigger.active }] : []
}).sort((a, b) => Number(b.direct) - Number(a.direct) || Number(a.paused) - Number(b.paused) || a.name.localeCompare(b.name)))

const { starting, start: startRun } = useStartRun(id, async (runId) => {
  await invalidate(liveTopics.runs)
  await navigateTo({ path: sessionsPath, query: { run: String(runId) } })
})
const startWorkflow = (workflowId: number) => startRun(workflowId, project.value?.defaultBranch ?? 'main')
</script>

<template>
  <div
    v-if="project"
    class="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[minmax(0,1fr)_clamp(340px,26vw,560px)]"
  >
    <!-- Sidebar sizing matches workflows/[id].vue, keep them in sync. -->
    <div class="flex min-w-0 flex-col gap-4.5">
      <KPanel
        v-if="!latestGroup || !latest"
        title="Sessions"
        icon="i-lucide-messages-square"
      >
        <div class="flex flex-col items-center gap-3 py-8 text-center">
          <img
            src="/mascot/mascotRight.png"
            alt="Knecht"
            class="h-16 w-auto drop-shadow-mascot"
          >
          <p class="text-2sm text-muted">
            No runs yet. Start a workflow to boot this project.
          </p>
        </div>
      </KPanel>
      <div
        v-else
        class="k-card overflow-hidden"
      >
        <div class="flex h-10 items-center gap-2.5 border-b border-muted px-4.5">
          <span class="k-mono text-2xs uppercase tracking-widest text-toned">Latest session</span>
          <KStatusBadge
            class="ml-auto"
            :meta="projectStatusMeta(latest)"
          />
        </div>
        <div class="grid grid-cols-1 gap-6 p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <NuxtLink
            :to="sessionTo(latestGroup)"
            :aria-label="`Open session ${sessionTitle(latestGroup)}`"
            class="relative block aspect-3/2 overflow-hidden rounded-md border border-default bg-(--surface-base) transition-colors hover:border-accented"
          >
            <iframe
              v-if="previewUrl"
              :src="previewUrl"
              title="Preview"
              tabindex="-1"
              loading="lazy"
              class="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-25"
            />
            <div
              v-else
              class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center"
            >
              <UIcon
                name="i-lucide-monitor-off"
                class="size-6 text-dimmed"
              />
              <p class="text-xs text-dimmed">
                No live preview
              </p>
            </div>
          </NuxtLink>

          <div class="flex min-w-0 flex-col">
            <span
              v-if="latestTicket"
              class="mb-1 flex min-w-0 items-center gap-1.5 text-xs text-muted"
            >
              <UIcon
                :name="latestTicket.meta.icon"
                class="size-3 flex-none"
                :style="{ color: latestTicket.closed ? 'var(--text-dimmed)' : latestTicket.meta.color }"
              />
              <span class="truncate">{{ latestTicket.meta.prefix }}{{ latestTicket.key }}</span>
            </span>
            <h2 class="truncate text-xl font-semibold tracking-tight text-highlighted">
              {{ sessionTitle(latestGroup) }}
            </h2>
            <p class="mt-1.5 text-2sm leading-snug text-muted">
              <UIcon
                v-if="latestDiagnosis?.state === 'pending'"
                name="i-lucide-loader-circle"
                class="mr-1 inline-block size-3 animate-spin motion-reduce:animate-none align-[-1px] text-dimmed"
              />{{ sessionStatusLine(latest) }}
            </p>
            <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
              <div
                v-for="f in latestFacts"
                :key="f.label"
                class="min-w-0"
              >
                <dt class="text-xs text-dimmed">
                  {{ f.label }}
                </dt>
                <dd class="mt-0.5 truncate text-2sm text-default">
                  <a
                    v-if="f.href"
                    :href="f.href"
                    target="_blank"
                    rel="noopener"
                    class="transition-colors hover:text-highlighted"
                  >{{ f.text }}</a>
                  <template v-else>
                    {{ f.text }}
                  </template>
                </dd>
              </div>
            </dl>
            <NuxtLink
              :to="sessionTo(latestGroup)"
              :aria-label="`Open session ${sessionTitle(latestGroup)}`"
              class="mt-auto flex self-end pt-3 text-dimmed transition-[color,translate] hover:translate-x-0.5 hover:text-highlighted"
            >
              <UIcon
                name="i-lucide-arrow-right"
                class="size-4.5"
              />
            </NuxtLink>
          </div>
        </div>

        <div
          v-if="otherGroups.length"
          class="border-t border-muted"
        >
          <div class="@container">
            <KSessionList
              :groups="otherGroups"
              :session-to="sessionTo"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4.5 lg:sticky lg:top-5">
      <KPanel
        title="Environment"
        icon="i-lucide-box"
      >
        <div class="flex items-end gap-3">
          <KRunSparkline
            :stats="stats"
            class="h-9 flex-1"
          />
          <KRunStatsText
            :stats="stats"
            class="flex-none"
          />
        </div>
        <dl class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 border-t border-muted pt-4 text-xs">
          <template
            v-for="f in environmentFacts"
            :key="f.label"
          >
            <dt class="text-dimmed">
              {{ f.label }}
            </dt>
            <dd class="truncate text-right text-toned">
              {{ f.text }}
            </dd>
          </template>
        </dl>
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
          class="flex max-h-80 flex-col gap-3 overflow-y-auto"
        >
          <div
            v-for="row in workflowRows"
            :key="row.id"
            class="flex items-center gap-3"
            :style="{ opacity: row.paused ? 0.55 : 1 }"
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
                <span class="block truncate text-xs text-default transition-colors group-hover:text-highlighted">
                  {{ row.name }}
                </span>
                <span class="block truncate text-2xs text-dimmed">
                  {{ row.paused ? 'Paused' : row.trigger.event }} · {{ triggerMeta(row.trigger).label }}<template v-if="row.more > 0"> · +{{ row.more }}</template>
                </span>
              </span>
            </NuxtLink>
            <UTooltip
              v-if="row.direct"
              :text="`Run ${row.name} on this project now`"
            >
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
            <UButton
              v-else
              :to="`/workflows/${row.id}`"
              icon="i-lucide-arrow-right"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Open ${row.name}`"
            />
          </div>
        </div>
      </KPanel>
    </div>
  </div>
</template>
