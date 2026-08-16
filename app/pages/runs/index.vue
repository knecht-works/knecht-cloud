<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'

// Global run history: every execution across all projects, newest first,
// grouped by session so runs on the same issue/PR read as one piece of work.
// A run drills into its project workspace; the list polls while anything is
// live.
const { data: runs, refresh } = await useFetch('/api/runs', { default: () => [] })

const anyLive = computed(() => (runs.value ?? []).some(r => isLiveStatus(r.status)))
usePollWhile(() => anyLive.value, refresh)

const metrics = computed(() => {
  const list = runs.value ?? []
  const completed = list.filter(r => r.status === 'success' || r.status === 'failed')
  const success = list.filter(r => r.status === 'success').length
  return {
    total: list.length,
    running: list.filter(r => isLiveStatus(r.status)).length,
    rate: completed.length ? Math.round((success / completed.length) * 100) : 0,
    // Distinct sessions whose environment is up: what is occupying the host.
    liveEnvs: new Set(list.filter(r => r.envState === 'up').map(r => r.sessionId)).size,
  }
})

// Session groups (utils/dashboard.ts) with the newest run exposed as `head`:
// the header row reads the project off it.
const sessionGroups = computed(() =>
  groupRunsBySession(runs.value ?? []).map(g => ({ ...g, head: g.runs[0]! })))
</script>

<template>
  <div>
    <KTopBar title="Runs">
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <div class="mb-5.5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KMetric
        :value="metrics.total"
        label="Runs"
      />
      <KMetric
        :value="metrics.running"
        label="Running now"
        accent="var(--accent-orange)"
      />
      <KMetric
        :value="metrics.rate"
        suffix="%"
        label="Avg success rate"
        accent="var(--primary)"
      />
      <KMetric
        :value="metrics.liveEnvs"
        label="Live environments"
        accent="var(--primary)"
      />
    </div>

    <!-- Empty state: no runs yet -->
    <div
      v-if="!runs.length"
      class="k-card flex flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <img
        src="/mascot/mascotRight.png"
        alt="Knecht"
        class="h-20 w-auto drop-shadow-mascot"
      >
      <div>
        <div class="text-sm font-medium text-toned">
          No runs yet
        </div>
        <p class="mx-auto mt-1.5 max-w-105 text-2sm leading-normal text-muted">
          A run is one execution of a workflow against a project. Start a workflow from a
          project, a workflow, or a trigger, and it shows up here.
        </p>
      </div>
    </div>

    <!-- Run list, grouped by session: an issue/PR session gets a header row
         (object, title, project, thread link) with its runs nested under it;
         one-shot runs (manual, push, schedule) stay plain rows. -->
    <div
      v-else
      class="k-card overflow-hidden"
    >
      <div
        v-for="(g, gi) in sessionGroups"
        :key="g.sessionId"
        :class="gi ? 'border-t border-muted' : ''"
      >
        <div
          v-if="g.object"
          class="flex items-center gap-2 px-4.5 pb-1 pt-3"
        >
          <UIcon
            :name="g.object.closed ? sessionObjectMeta(g.object.kind).closedIcon : sessionObjectMeta(g.object.kind).icon"
            class="size-3.5 flex-none"
            :style="{ color: g.object.closed ? 'var(--text-dimmed)' : sessionObjectMeta(g.object.kind).color }"
          />
          <span class="k-mono flex-none text-2xs text-dimmed">#{{ g.object.number }}</span>
          <UTooltip :text="g.object.title ?? ''">
            <span
              class="k-mono min-w-0 truncate text-2xs"
              :class="g.object.closed ? 'text-dimmed' : 'text-muted'"
            >{{ g.object.title }}</span>
          </UTooltip>
          <span class="ml-auto flex flex-none items-center gap-2">
            <NuxtLink
              :to="`/projects/${g.head.projectId}`"
              class="k-mono hidden text-2xs text-dimmed transition-colors hover:text-muted md:block"
            >{{ g.head.project }}</NuxtLink>
            <KStatusDot
              v-if="g.object.live"
              color="primary"
              :size="5"
            />
            <a
              v-if="g.object.url"
              :href="g.object.url"
              target="_blank"
              class="flex text-dimmed transition-colors hover:text-muted"
              :aria-label="`Open ${g.object.kind === 'issue' ? 'issue' : 'pull request'} #${g.object.number} on GitHub`"
            >
              <UIcon
                name="i-lucide-arrow-up-right"
                class="size-3.5"
              />
            </a>
          </span>
        </div>
        <NuxtLink
          v-for="r in g.runs"
          :key="r.id"
          :to="runWorkspacePath(r.projectId, r.id)"
          class="flex items-center gap-3 py-3 pr-4.5 transition-colors hover:bg-(--surface-glass)"
          :class="g.object ? 'pl-8' : 'pl-4.5'"
        >
          <KStatusDot
            :color="RUN_STATUS_META[r.status].dot"
            :pulse="RUN_STATUS_META[r.status].pulse"
            :size="6"
          />
          <span class="k-mono truncate text-xs text-default">{{ r.workflow }}</span>
          <span class="k-mono text-2xs text-dimmed">#{{ r.id }}</span>
          <span
            v-if="!g.object"
            class="k-mono hidden min-w-0 truncate text-2xs text-muted md:block"
          >{{ r.project }}</span>

          <span class="k-mono ml-auto w-14 flex-none text-right text-2xs text-dimmed">{{ runDuration(r.startedAt, r.finishedAt) }}</span>
          <span class="k-mono hidden w-16 flex-none text-right text-2xs text-dimmed sm:block">{{ timeAgo(r.createdAt) }}</span>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
