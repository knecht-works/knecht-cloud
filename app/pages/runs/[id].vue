<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)

const { data: run, refresh } = await useFetch(`/api/runs/${id}`)

const isLive = computed(() => run.value?.status === 'queued' || run.value?.status === 'running')
const statusMeta = computed(() => run.value ? RUN_STATUS_META[run.value.status] : IDLE_STATUS_META)

const TRIGGER_META: Record<string, { icon: string, label: string }> = {
  manual: { icon: 'i-lucide-mouse-pointer-click', label: 'Manual' },
  schedule: { icon: 'i-lucide-clock', label: 'Schedule' },
  github: { icon: 'i-lucide-github', label: 'GitHub webhook' },
}

// The run's meta facts (how it was triggered, the branch it works on, timing,
// the PR it opened) — chips are skipped when a run predates the recorded field.
const meta = computed(() => {
  const r = run.value
  if (!r) return []
  const trigger = r.trigger
    ? TRIGGER_META[r.trigger] ?? { icon: 'i-lucide-zap', label: r.trigger }
    : null
  return [
    trigger && { icon: trigger.icon, text: trigger.label },
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
    toast.add({
      title: 'Delete failed',
      description: errMsg(e, ''),
      color: 'error',
    })
  }
}

const rebooting = ref(false)
async function reboot() {
  rebooting.value = true
  try {
    run.value = await $fetch(`/api/runs/${id}/reboot`, { method: 'POST' })
  }
  catch (e) {
    toast.add({
      title: 'Reboot failed',
      description: errMsg(e, ''),
      color: 'error',
    })
  }
  finally {
    rebooting.value = false
  }
}

usePollWhile(() => isLive.value, refresh)
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
        :is="m.href ? 'a' : 'span'"
        v-for="m in meta"
        :key="m.icon"
        :href="m.href"
        :target="m.href ? '_blank' : undefined"
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
          <p class="max-w-[520px] text-[13px] text-(--text-muted)">
            The environment was stopped after being idle. Reboot it to preview again — the
            imported database and built files are kept.
          </p>
          <UButton
            color="primary"
            label="Reboot"
            icon="i-lucide-power"
            :loading="rebooting"
            @click="reboot"
          />
        </div>
      </template>

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
