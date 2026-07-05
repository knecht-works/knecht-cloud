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
// step registry. Unknown step types (e.g. removed ones) render generically.
const timeline = computed(() => (stepRows.value ?? []).map((s) => {
  const def = STEP_DEFS.find(d => d.type === s.type)
  return {
    ...s,
    icon: def?.icon ?? 'i-lucide-square',
    label: def?.label ?? s.type,
    color: STEP_KIND_COLOR[def?.kind ?? 'det'],
    statusMeta: RUN_STATUS_META[s.status],
  }
}))

// The run's meta facts (how it was triggered, the branch it works on, timing,
// the PR it opened) — chips are skipped when a run predates the recorded field.
// A run fired by a configured trigger links back to its workflow (where its
// triggers are managed).
const meta = computed(() => {
  const r = run.value
  if (!r) return []
  const trigger = r.trigger ? triggerSourceMeta(r.trigger) : null
  return [
    trigger && { icon: trigger.icon, text: trigger.label, href: r.triggerId ? `/workflows/${encodeURIComponent(r.workflow)}` : undefined },
    r.branch && { icon: 'i-lucide-git-branch', text: r.branch },
    r.startedAt && { icon: 'i-lucide-timer', text: runDuration(r.startedAt, r.finishedAt) },
    r.createdAt && { icon: 'i-lucide-calendar', text: timeAgo(r.createdAt) },
    r.prUrl && { icon: 'i-lucide-git-pull-request', text: 'Pull request', href: r.prUrl },
  ].filter(Boolean) as { icon: string, text: string, href?: string }[]
})

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
// ('down') can't be rebooted — its sandbox and worktree are gone — so re-running
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
    <div class="mb-3.5 flex items-center gap-2 text-(--text-dimmed)">
      <NuxtLink
        to="/projects"
        class="k-mono text-xs transition-colors hover:text-(--text-muted)"
      >
        Projects
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <NuxtLink
        :to="`/projects/${run.projectId}`"
        class="k-mono truncate text-xs transition-colors hover:text-(--text-muted)"
      >
        {{ run.project }}
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono text-xs text-(--text-muted)">Run #{{ run.id }}</span>
    </div>

    <KTopBar :title="`Run #${run.id}`">
      <template #actions>
        <UButton
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          label="Delete"
          :loading="deleting"
          @click="remove"
        />
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
        class="flex items-center gap-1.5 text-(--text-dimmed)"
        :class="m.href ? 'transition-colors hover:text-(--text-muted)' : ''"
      >
        <UIcon
          :name="m.icon"
          class="size-[13px]"
        />
        <span class="k-mono text-xs text-(--text-muted)">{{ m.text }}</span>
      </component>
    </div>

    <div class="flex flex-col gap-[18px]">
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
            class="max-w-[520px] text-[13px] text-(--text-muted)"
          >
            This environment was archived. Its exact code state and database are kept,
            and restoring rebuilds it in a few minutes.
          </p>
          <p
            v-else
            class="max-w-[520px] text-[13px] text-(--text-muted)"
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
        <p class="max-w-[520px] text-[13px] text-(--text-muted)">
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
        <ul class="divide-y divide-(--border-muted)">
          <li
            v-for="s in timeline"
            :key="s.id"
            class="flex items-center gap-3 px-[18px] py-3"
            :class="s.parentStepId ? 'pl-12' : ''"
          >
            <KStepIcon
              :icon="s.icon"
              :size="30"
              :radius="7"
              :color="s.color"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="truncate text-[13px] text-(--text-highlighted)">{{ s.label }}</span>
                <span class="k-mono text-[10px] text-(--text-dimmed)">{{ s.stepId }}</span>
                <span
                  v-if="s.iteration !== null"
                  class="k-mono text-[10px] text-(--text-dimmed)"
                >#{{ s.iteration + 1 }}</span>
                <span
                  v-if="s.attempt > 1"
                  class="k-mono text-[10px] text-(--accent-orange)"
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
            <span class="k-mono text-[11px] text-(--text-dimmed)">{{ runDuration(s.startedAt, s.finishedAt) }}</span>
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
            <span class="k-mono text-[11px] text-(--text-muted)">{{ run.workflow }} · {{ run.project }}</span>
          </span>
        </template>
        <div class="k-mono max-h-[420px] overflow-auto whitespace-pre-wrap px-[18px] py-4 text-xs leading-[1.85] text-(--text-muted)">
          {{ run.log || '…' }}
        </div>
      </KPanel>
    </div>
  </div>
</template>
