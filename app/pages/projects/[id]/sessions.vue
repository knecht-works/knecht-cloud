<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { useRoute, navigateTo, $fetch } from '#imports'
import { useRuns } from '~/composables/useRuns'
import { computed, ref, onMounted, watch } from 'vue'
import { groupRunsBySession } from '~/utils/dashboard'
import { invalidate } from '~/composables/useLiveTopics'
import KRunWorkspace from '~/components/KRunWorkspace.vue'
import KPreviewBrowser from '~/components/KPreviewBrowser.vue'
import KStatusDot from '~/components/KStatusDot.vue'
import KSessionNav from '~/components/KSessionNav.vue'
import KSessionStatus from '~/components/KSessionStatus.vue'

const route = useRoute()
const id = Number(route.params.id)

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

async function onRunStarted(runId: number) {
  await invalidate(liveTopics.runs)
  lastSeenLatestId.value = runId
  await navigateTo({ query: { ...route.query, session: undefined, run: String(runId) } }, { replace: true })
}

async function onRunDeleted() {
  if (offListRun.value?.id === selectedRun.value?.id) offListRun.value = null
  await invalidate(liveTopics.runs)
}
</script>

<template>
  <div class="-mx-8 -mb-7 flex flex-col lg:flex-row">
    <!-- Bleeds out of the page padding so the list sits flush against the app sidebar. -->
    <div class="flex-none border-b border-default lg:w-64 lg:border-b-0">
      <nav
        aria-label="Sessions"
        class="k-scrollbar-none flex max-h-80 flex-col overflow-y-auto px-5 pb-2 lg:sticky lg:top-0 lg:max-h-dvh"
      >
        <button
          v-if="newRun"
          type="button"
          class="mx-1 mb-1 flex cursor-pointer items-center gap-1.5 self-start rounded-full border border-(--primary-border) px-2.5 py-1 text-2xs text-primary transition-colors hover:text-highlighted"
          @click="selectSession(newRun.sessionId)"
        >
          <KStatusDot
            color="primary"
            pulse
            :size="5"
          />
          New run #{{ newRun.id }}
        </button>
        <p
          v-if="!projectRuns.length"
          class="px-3 py-2 text-2sm text-muted"
        >
          No sessions yet.
        </p>
        <KSessionNav
          :groups="sessionGroups"
          :session-to="g => ({ query: { session: String(g.sessionId) } })"
          :selected-session-id="selectedSessionId"
        />
      </nav>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-4.5 px-8 pb-7 lg:pl-1">
      <KSessionStatus
        v-if="selectedRun?.status === 'failed'"
        :run="selectedRun"
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
  </div>
</template>
