<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { previewHostname } from '#shared/utils/preview-host'
import { formatDatabase, projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { useRoute, useRequestURL, navigateTo } from '#imports'
import { useProject } from '~/composables/useProjects'
import { useRuns, useRunStatsBy } from '~/composables/useRuns'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { groupRunsBySession, projectStatusMeta, sessionObjectMeta, sessionTitle, sessionTicket, sessionBranch, sessionPr, sessionStatusLine, frameworkMeta, timeAgo, triggerMeta } from '~/utils/dashboard'
import { integrationUi } from '~/utils/integrations'
import { useWorkflows, useTriggers } from '~/composables/useWorkflows'
import { workflowRunnable } from '~/utils/workflow-steps'
import { useStartRun } from '~/composables/useStartRun'
import { invalidate } from '~/composables/useLiveTopics'
import KPanel from '~/components/KPanel.vue'
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

const fullTime = (at: string | null | undefined) => (at ? new Date(at).toLocaleString() : undefined)

const activeGroups = computed(() => sessionGroups.value.filter(g => g.runs[0]!.sessionStatus !== 'closed'))
const latestGroup = computed(() => activeGroups.value[0] ?? sessionGroups.value[0] ?? null)
const latest = computed(() => latestGroup.value?.runs[0] ?? null)
// What started the session is its first run; later runs are follow-ups such as mentions.
// A session started by hand has no workflow and is named "New Preview Session" or "New Code Session".
function startedAs(g: (typeof sessionGroups.value)[number]) {
  const first = g.runs.at(-1)!
  if (first.workflowId === null) return first.workflow.replace(/^New /, '')
  return first.workflow === sessionTitle(g) ? null : first.workflow
}

const otherGroups = computed(() => activeGroups.value.filter(g => g !== latestGroup.value).map((g) => {
  const ticket = sessionTicket(g)
  const meta = ticket && sessionObjectMeta(ticket.integration, ticket.kind)
  return {
    group: g,
    icon: meta?.icon ?? 'i-lucide-messages-square',
    color: meta && !ticket!.closed ? meta.color : 'var(--text-dimmed)',
    detail: [meta && `${meta.prefix}${ticket!.key}`, startedAs(g)].filter(Boolean).join(' · '),
  }
}))
const doneSessions = computed(() => sessionGroups.value.filter(g => g !== latestGroup.value).length - otherGroups.value.length)

const latestDiagnosis = computed(() => latest.value?.status === 'failed' ? latest.value.failureDiagnosis : null)
const latestTicket = computed(() => {
  const o = latestGroup.value && sessionTicket(latestGroup.value)
  return o ? { ...o, meta: sessionObjectMeta(o.integration, o.kind) } : null
})
const latestFacts = computed(() => {
  const g = latestGroup.value
  if (!g) return []
  const pr = sessionPr(g)
  const run = g.runs[0]!
  const ticket = latestTicket.value
  const facts: { label: string, text?: string | null, to?: RouteLocationRaw, href?: string, tip?: string }[] = [
    { label: ticket ? `${integrationUi(ticket.integration).label} ${ticket.meta.label}` : '', text: ticket && `${ticket.meta.prefix}${ticket.key}`, href: ticket?.url ?? undefined },
    { label: 'Last run', text: timeAgo(run.createdAt), to: sessionTo(g), tip: fullTime(run.createdAt) },
    { label: 'Branch', text: sessionBranch(g), to: sessionTo(g) },
    { label: 'Pull request', text: pr?.label, href: pr?.url },
  ]
  return facts.filter(f => f.text)
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
    { label: 'PHP', text: ddev ? e?.phpVersion : env.phpVersion.value },
    { label: 'Database', text: ddev ? e?.dbType && `${e.dbType}${e.dbVersion ? ` ${e.dbVersion}` : ''}` : env.database.value && formatDatabase(env.database.value) },
    { label: 'Node', text: ddev ? e?.nodeVersion : env.nodeVersion.value },
  ].filter(f => f.text)
})

const { data: workflowList } = useWorkflows()
const { data: triggers } = useTriggers()
// A schedule or manual trigger needs no object, so its workflow can be started right here.
const startsDirectly = (t: { source: string }) => t.source === 'schedule' || t.source === 'manual'
const workflowRows = computed(() => (workflowList.value ?? []).filter(workflowRunnable).flatMap((w) => {
  const own = (triggers.value ?? []).filter(t => t.projectIds.includes(id) && t.workflowId === w.id)
  const active = own.filter(t => t.active)
  const shown = active.length ? active : own
  const trigger = shown.find(startsDirectly) ?? shown[0]
  return trigger ? [{ id: w.id, name: w.name, trigger, more: own.length - 1, direct: startsDirectly(trigger), paused: !w.enabled || !active.length }] : []
}).sort((a, b) => Number(b.direct) - Number(a.direct) || Number(a.paused) - Number(b.paused) || a.name.localeCompare(b.name)))

const { starting, start: startRun } = useStartRun(id, async (runId) => {
  await invalidate(liveTopics.runs)
  await navigateTo({ path: sessionsPath, query: { run: String(runId) } })
})
// The trigger's branch is the base of its runs, as when the trigger fires on its own.
function startWorkflow(row: { id: number, trigger: { branch: string | null } }) {
  const base = row.trigger.branch ?? project.value?.defaultBranch ?? 'main'
  return startRun(row.id, base, base)
}
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
          <UIcon
            name="i-lucide-messages-square"
            class="size-4 text-primary"
          />
          <span class="k-mono text-2xs uppercase tracking-widest text-toned">Sessions</span>
          <NuxtLink
            :to="sessionsPath"
            aria-label="All sessions"
            class="ml-auto flex text-dimmed transition-[color,translate] hover:translate-x-0.5 hover:text-highlighted"
          >
            <UIcon
              name="i-lucide-arrow-right"
              class="size-4"
            />
          </NuxtLink>
        </div>
        <div class="grid grid-cols-1 gap-6 p-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div class="min-w-0">
            <NuxtLink
              :to="sessionTo(latestGroup)"
              :aria-label="`Open session ${sessionTitle(latestGroup)}`"
              class="relative block aspect-3/2 sm:aspect-auto sm:h-full overflow-hidden rounded-md border border-default bg-(--surface-base) transition-colors hover:border-accented"
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
          </div>

          <div class="flex min-w-0 flex-col">
            <div class="mb-1 flex min-w-0 items-center gap-1.5 text-2sm text-muted">
              <span class="flex-none text-dimmed">Latest session</span>
              <KStatusBadge
                class="ml-auto"
                :meta="projectStatusMeta(latest)"
              />
            </div>
            <h2 class="truncate text-xl font-semibold tracking-tight text-highlighted">
              <NuxtLink :to="sessionTo(latestGroup)">
                {{ sessionTitle(latestGroup) }}
              </NuxtLink>
            </h2>
            <p class="mt-2 max-w-[60ch] text-sm leading-relaxed text-toned">
              <UIcon
                v-if="latestDiagnosis?.state === 'pending'"
                name="i-lucide-loader-circle"
                class="mr-1 inline-block size-3 animate-spin motion-reduce:animate-none align-[-1px] text-dimmed"
              />{{ sessionStatusLine(latest) }}
            </p>
            <div
              v-if="latestDiagnosis?.state === 'done' && latestDiagnosis.steps.length && latest.workflowId"
              class="mt-3 flex flex-wrap gap-1.5"
            >
              <UButton
                v-for="s in latestDiagnosis.steps"
                :key="s.id"
                :to="{ path: `/workflows/${latest.workflowId}`, query: { step: s.stepId } }"
                :label="`Open step ${s.label}`"
                color="neutral"
                variant="outline"
              />
            </div>
            <dl class="mt-8 grid grid-cols-2 gap-x-6 gap-y-4">
              <div
                v-for="f in latestFacts"
                :key="f.label"
                class="min-w-0"
              >
                <dt class="text-xs text-muted">
                  {{ f.label }}
                </dt>
                <dd class="mt-1 truncate text-sm text-highlighted">
                  <UTooltip
                    :text="f.tip"
                    :disabled="!f.tip"
                  >
                    <a
                      v-if="f.href"
                      :href="f.href"
                      target="_blank"
                      rel="noopener"
                      class="transition-colors hover:text-highlighted"
                    >{{ f.text }}</a>
                    <NuxtLink
                      v-else-if="f.to"
                      :to="f.to"
                      class="transition-colors hover:text-highlighted"
                    >
                      {{ f.text }}
                    </NuxtLink>
                    <span v-else>{{ f.text }}</span>
                  </UTooltip>
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
          v-if="otherGroups.length || doneSessions"
          class="border-t border-muted"
        >
          <NuxtLink
            v-for="o in otherGroups"
            :key="o.group.sessionId"
            :to="sessionTo(o.group)"
            class="flex items-center gap-3 border-b border-muted px-5 py-3 transition-colors last:border-b-0 hover:bg-elevated/30"
          >
            <UIcon
              :name="o.icon"
              class="size-4 flex-none"
              :style="{ color: o.color }"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-highlighted">{{ sessionTitle(o.group) }}</span>
              <span class="block truncate text-xs text-dimmed">{{ o.detail }}</span>
            </span>
            <KStatusBadge :meta="projectStatusMeta(o.group.runs[0])" />
            <UTooltip
              :text="fullTime(o.group.runs[0]!.createdAt)"
              :disabled="!o.group.runs[0]!.createdAt"
            >
              <span class="w-14 flex-none text-right text-xs tabular-nums text-dimmed">{{ timeAgo(o.group.runs[0]!.createdAt) }}</span>
            </UTooltip>
          </NuxtLink>
          <NuxtLink
            v-if="doneSessions"
            :to="{ path: sessionsPath, query: { done: '1' } }"
            class="block border-t border-muted px-5 py-2.5 text-xs text-dimmed transition-colors first:border-t-0 hover:text-highlighted"
          >
            {{ doneSessions }} done {{ doneSessions === 1 ? 'session' : 'sessions' }}
          </NuxtLink>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4.5 lg:sticky lg:top-5">
      <KPanel
        title="Environment"
        icon="i-lucide-box"
      >
        <template #action>
          <NuxtLink
            :to="`/projects/${id}/settings`"
            aria-label="Environment settings"
            class="flex text-dimmed transition-[color,translate] hover:translate-x-0.5 hover:text-highlighted"
          >
            <UIcon
              name="i-lucide-arrow-right"
              class="size-4"
            />
          </NuxtLink>
        </template>
        <div class="flex items-end gap-3">
          <KRunSparkline
            :stats="stats"
            class="h-20 flex-1"
          />
          <KRunStatsText
            :stats="stats"
            class="flex-none"
          />
        </div>
        <dl class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1 border-t border-muted pt-4 text-2sm">
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
        :pad="0"
      >
        <template #action>
          <NuxtLink
            :to="'/workflows'"
            aria-label="All workflows"
            class="flex text-dimmed transition-[color,translate] hover:translate-x-0.5 hover:text-highlighted"
          >
            <UIcon
              name="i-lucide-arrow-right"
              class="size-4"
            />
          </NuxtLink>
        </template>
        <p
          v-if="!workflowRows.length"
          class="px-5 py-4.25 text-2sm text-muted"
        >
          No workflow is triggered by this project.
        </p>
        <div
          v-else
          class="@container"
        >
          <div class="k-scrollbar-slim max-h-80 overflow-y-auto py-4.25">
            <!-- Sized from the panel, not the scroll area: a scrollbar that takes up width must not shift the rows. -->
            <div class="ml-5 flex w-[calc(100cqw-2.5rem)] flex-col gap-3">
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
                    class="-mr-1"
                    :aria-label="`Run ${row.name} now`"
                    :disabled="starting"
                    @click="startWorkflow(row)"
                  />
                </UTooltip>
                <UButton
                  v-else
                  :to="`/workflows/${row.id}`"
                  icon="i-lucide-arrow-right"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="-mr-1"
                  :aria-label="`Open ${row.name}`"
                />
              </div>
            </div>
          </div>
        </div>
      </KPanel>
    </div>
  </div>
</template>
