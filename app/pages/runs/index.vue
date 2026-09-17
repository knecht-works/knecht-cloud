<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'

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
    liveEnvs: new Set(list.filter(r => r.envState === 'up').map(r => r.sessionId)).size,
  }
})

const sessionGroups = computed(() => groupRunsBySession(runs.value ?? []))
</script>

<template>
  <div>
    <KTopBar title="Runs">
      <template #actions>
        <KAppSearch />
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

    <KPanel
      v-else
      title="Sessions"
      icon="i-lucide-messages-square"
      :pad="0"
    >
      <template #action>
        <span class="k-mono text-2xs text-dimmed">{{ sessionGroups.length }} {{ sessionGroups.length === 1 ? 'session' : 'sessions' }}</span>
      </template>
      <KSessionList
        :groups="sessionGroups"
        :run-to="r => runWorkspacePath(r.projectId, r.id)"
        show-project
      />
    </KPanel>
  </div>
</template>
