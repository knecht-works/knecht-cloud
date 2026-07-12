<script setup lang="ts">
const route = useRoute()
const toastError = useToastError()
const id = Number(route.params.id)
const NuxtLink = resolveComponent('NuxtLink')

const { data: run, refresh } = await useFetch(`/api/runs/${id}`)
const { data: stepRows, refresh: refreshSteps } = await useFetch(`/api/runs/${id}/steps`)

const isLive = computed(() => isLiveStatus(run.value?.status))
const statusMeta = computed(() => run.value ? RUN_STATUS_META[run.value.status] : IDLE_STATUS_META)

// The step timeline: one row per executed step (run_steps), styled via the
// step registry. Unknown step types (e.g. removed ones) render generically;
// nested rows indent by their ancestor count (parentStepId chains).
const timeline = computed(() => {
  const rows = stepRows.value ?? []
  const byStepId = new Map(rows.map(r => [r.stepId, r]))
  const depthOf = (row: (typeof rows)[number]) => {
    let depth = 0
    for (let p = row.parentStepId; p; p = byStepId.get(p)?.parentStepId ?? null) depth++
    return depth
  }
  return rows.map((s) => {
    const def = stepDefFor(s.type)
    return {
      ...s,
      depth: depthOf(s),
      icon: def?.icon ?? 'i-lucide-square',
      label: def?.label ?? s.type,
      color: STEP_KIND_COLOR[def?.kind ?? 'det'],
      statusMeta: RUN_STATUS_META[s.status],
    }
  })
})

// The step behind the failure card: rows are in execution order, so the last
// row carrying an error is the most specific one (a composite is finalized
// after the child that failed it). Null when the run failed before any step
// recorded an error (e.g. a runner crash); the card then points at the log.
const failedStep = computed(() => {
  if (run.value?.status !== 'failed') return null
  return [...timeline.value].reverse().find(s => s.error) ?? null
})

// The run's meta facts (the workflow it executes, how it was triggered, the
// branch it works on, timing, the PR it opened). Chips are skipped when a run
// predates the recorded field. The workflow chip links to the editor.
const meta = computed(() => {
  const r = run.value
  if (!r) return []
  const trigger = r.trigger ? triggerSourceMeta(r.trigger) : null
  return [
    { icon: 'i-lucide-workflow', text: r.workflow, href: `/workflows/${encodeURIComponent(r.workflow)}` },
    trigger && { icon: trigger.icon, text: trigger.label },
    r.branch && { icon: 'i-lucide-git-branch', text: r.branch },
    r.startedAt && { icon: 'i-lucide-timer', text: runDuration(r.startedAt, r.finishedAt) },
    r.createdAt && { icon: 'i-lucide-calendar', text: timeAgo(r.createdAt) },
    r.prUrl && { icon: 'i-lucide-git-pull-request', text: 'Pull request', href: r.prUrl },
  ].filter(Boolean) as { icon: string, text: string, href?: string }[]
})

// Destructive, so it lives in the header's overflow menu behind a confirm.
const confirmDelete = ref(false)
const menuItems = [{
  label: 'Delete run',
  icon: 'i-lucide-trash-2',
  color: 'error' as const,
  onSelect: () => { confirmDelete.value = true },
}]
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/runs/${id}`, { method: 'DELETE' })
    await navigateTo('/runs')
  }
  catch (e) {
    deleting.value = false
    toastError('Delete failed', e)
  }
}

// Start the same workflow on the same project as a NEW run. A torn-down env
// ('down') can't be rebooted (its sandbox and worktree are gone), so re-running
// is the way to get a fresh preview. Deliberately does not reuse run.branch:
// a create-branch step overwrote it with the run's own work branch.
const restarting = ref(false)
async function runAgain() {
  if (!run.value) return
  restarting.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: run.value.projectId, workflow: run.value.workflow },
    })
    await navigateTo(`/runs/${created.id}`)
  }
  catch (e) {
    restarting.value = false
    toastError('Failed to start run', e)
  }
}

// Stop the live run server-side; the runner unwinds at its next checkpoint.
const cancelling = ref(false)
async function cancel() {
  cancelling.value = true
  try {
    await $fetch(`/api/runs/${id}/cancel`, { method: 'POST' })
    await refresh()
  }
  catch (e) {
    toastError('Cancel failed', e)
  }
  finally {
    cancelling.value = false
  }
}

// Resume from the step that stopped the run: completed steps keep their
// results, only the failed step onward re-executes. Polling resumes via isLive.
// For failed runs the retry button lives in the failure card; the header
// button covers cancelled runs.
const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await $fetch(`/api/runs/${id}/retry`, { method: 'POST' })
    await Promise.all([refresh(), refreshSteps()])
  }
  catch (e) {
    toastError('Retry failed', e)
  }
  finally {
    retrying.value = false
  }
}

const rebooting = ref(false)
async function reboot() {
  rebooting.value = true
  try {
    run.value = await $fetch(`/api/runs/${id}/reboot`, { method: 'POST' })
  }
  catch (e) {
    toastError(run.value?.envState === 'archived' ? 'Restore failed' : 'Reboot failed', e)
  }
  finally {
    rebooting.value = false
  }
}

usePollWhile(() => isLive.value, () => Promise.all([refresh(), refreshSteps()]))
</script>

<template>
  <div v-if="run">
    <div class="mb-3.5 flex items-center gap-2 text-dimmed">
      <NuxtLink
        to="/projects"
        class="k-mono text-xs transition-colors hover:text-muted"
      >
        Projects
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <NuxtLink
        :to="`/projects/${run.projectId}`"
        class="k-mono truncate text-xs transition-colors hover:text-muted"
      >
        {{ run.project }}
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono text-xs text-muted">Run #{{ run.id }}</span>
    </div>

    <KTopBar :title="`Run #${run.id}`">
      <template #actions>
        <UButton
          v-if="isLive"
          color="error"
          variant="outline"
          label="Cancel run"
          :loading="cancelling"
          @click="cancel"
        />
        <UButton
          v-else-if="run.status === 'cancelled'"
          color="primary"
          icon="i-lucide-play"
          label="Retry"
          :loading="retrying"
          @click="retry"
        />
        <UDropdownMenu
          :items="menuItems"
          :content="{ align: 'end' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            aria-label="More actions"
          />
        </UDropdownMenu>
      </template>
    </KTopBar>

    <div
      v-if="meta.length"
      class="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <component
        :is="m.href ? NuxtLink : 'span'"
        v-for="m in meta"
        :key="m.icon"
        :href="m.href"
        :target="m.href?.startsWith('http') ? '_blank' : undefined"
        class="flex items-center gap-1.5 text-dimmed"
        :class="m.href ? 'transition-colors hover:text-muted' : ''"
      >
        <UIcon
          :name="m.icon"
          class="size-3.5"
        />
        <span class="k-mono text-xs text-muted">{{ m.text }}</span>
      </component>
    </div>

    <div class="flex flex-col gap-4.5">
      <div
        v-if="run.status === 'failed'"
        class="k-card flex flex-wrap items-center justify-between gap-4 p-5"
      >
        <div class="min-w-0 max-w-130">
          <p class="text-2sm text-highlighted">
            <template v-if="failedStep">
              This run failed at "{{ failedStep.label }}" ({{ failedStep.stepId }}).
            </template>
            <template v-else>
              This run failed before a step could report an error.
            </template>
          </p>
          <p
            v-if="failedStep?.error"
            class="mt-1 text-xs"
            style="color: var(--status-error)"
          >
            {{ failedStep.error }}
          </p>
          <p
            v-else
            class="mt-1 text-xs text-muted"
          >
            Check the log below for details.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-workflow"
            :label="failedStep ? 'Fix failed step' : 'Edit workflow'"
            :to="`/workflows/${encodeURIComponent(run.workflow)}${failedStep ? `?step=${encodeURIComponent(failedStep.stepId)}` : ''}`"
          />
          <UButton
            color="primary"
            icon="i-lucide-play"
            label="Retry"
            :loading="retrying"
            @click="retry"
          />
        </div>
      </div>

      <template v-if="run.envState !== 'down'">
        <KPreviewBrowser
          v-if="run.envState === 'up'"
          :run-id="run.id"
          :hosts="run.previewHosts ?? []"
          online
        />

        <div
          v-else
          class="k-card flex flex-wrap items-center justify-between gap-4 p-5"
        >
          <p
            v-if="run.envState === 'archived'"
            class="max-w-130 text-2sm text-muted"
          >
            This environment was archived. Its exact code state and database are kept,
            and restoring rebuilds it in a few minutes.
          </p>
          <p
            v-else
            class="max-w-130 text-2sm text-muted"
          >
            The environment was stopped after being idle. Reboot it to preview again;
            the imported database and built files are kept.
          </p>
          <UButton
            color="primary"
            :label="run.envState === 'archived' ? 'Restore' : 'Reboot'"
            :icon="run.envState === 'archived' ? 'i-lucide-archive-restore' : 'i-lucide-power'"
            :loading="rebooting"
            @click="reboot"
          />
        </div>
      </template>

      <div
        v-else-if="!isLive"
        class="k-card flex flex-wrap items-center justify-between gap-4 p-5"
      >
        <p class="max-w-130 text-2sm text-muted">
          This run's environment and its archive are gone, so there is nothing left to
          restore. Run the workflow again to get a fresh environment.
        </p>
        <UButton
          color="primary"
          label="Run again"
          icon="i-lucide-play"
          :loading="restarting"
          @click="runAgain"
        />
      </div>

      <KPanel
        v-if="timeline.length"
        title="Steps"
        icon="i-lucide-list-checks"
        :pad="0"
      >
        <ul class="divide-y divide-muted">
          <li
            v-for="s in timeline"
            :key="s.id"
            class="flex items-center gap-3 px-4.5 py-3"
            :style="s.depth ? { paddingLeft: `${18 + s.depth * 26}px` } : undefined"
          >
            <KStepIcon
              :icon="s.icon"
              :size="30"
              :radius="7"
              :color="s.color"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="truncate text-2sm text-highlighted">{{ s.label }}</span>
                <span class="k-mono text-3xs text-dimmed">{{ s.stepId }}</span>
                <span
                  v-if="s.iteration !== null"
                  class="k-mono text-3xs text-dimmed"
                >#{{ s.iteration + 1 }}</span>
                <span
                  v-if="s.attempt > 1"
                  class="k-mono text-3xs text-accent-orange"
                >{{ s.attempt }} attempts</span>
              </div>
              <p
                v-if="s.error"
                class="truncate text-xs"
                style="color: var(--status-error)"
              >
                {{ s.error }}
              </p>
            </div>
            <span class="k-mono text-2xs text-dimmed">{{ runDuration(s.startedAt, s.finishedAt) }}</span>
            <KStatusDot
              :color="s.statusMeta.dot"
              :pulse="s.statusMeta.pulse"
              :size="6"
            />
          </li>
        </ul>
      </KPanel>

      <KPanel
        title="Log"
        icon="i-lucide-terminal"
        :pad="0"
      >
        <template #action>
          <span class="flex items-center gap-2">
            <KStatusDot
              :color="statusMeta.dot"
              :pulse="statusMeta.pulse"
              :size="6"
            />
            <span class="k-mono text-2xs text-muted">{{ run.workflow }} · {{ run.project }}</span>
          </span>
        </template>
        <KLogView
          :log="run.log"
          class="px-4.5 py-4 text-xs leading-loose"
        />
      </KPanel>
    </div>

    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete run"
      :description="`Deletes run #${run.id} including its log and preview environment. This cannot be undone.`"
      confirm-label="Delete"
      :loading="deleting"
      @confirm="remove"
    />
  </div>
</template>
