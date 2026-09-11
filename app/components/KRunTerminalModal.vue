<script setup lang="ts">
interface SshInfo { services: string[], sshCommands: Record<string, string> | null }

const props = defineProps<{ runId: number }>()
const open = defineModel<boolean>('open', { required: true })

const toastError = useToastError()
const toast = useToast()
const terminalService = ref('web')
const sshInfo = ref<SshInfo | null>(null)
const terminalServices = computed(() => sshInfo.value?.services ?? [])

watch(open, async (isOpen) => {
  if (!isOpen) return
  terminalService.value = 'web'
  try {
    sshInfo.value = await $fetch<SshInfo>(`/api/runs/${props.runId}/ssh`)
  }
  catch {
    sshInfo.value = { services: ['web'], sshCommands: null }
  }
})

async function copySshCommand() {
  const command = sshInfo.value?.sshCommands?.[terminalService.value]
  if (!command) return
  try {
    await copyText(command)
    toast.add({ title: 'Command copied', color: 'success' })
  }
  catch (e) {
    toastError('Could not copy', e)
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Terminal · Run #${runId}`"
    description="A shell inside the run's environment. Files and databases you touch here are the preview's."
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <div v-if="terminalServices.length > 1">
          <span class="k-label">Container</span>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="s in terminalServices"
              :key="s"
              type="button"
              class="k-mono cursor-pointer rounded-full border px-2.5 py-1 text-2xs transition-colors"
              :class="terminalService === s
                ? 'border-(--primary-border) bg-(--lime-950) text-primary'
                : 'border-default text-dimmed hover:text-muted'"
              @click="terminalService = s"
            >
              {{ s }}
            </button>
          </div>
        </div>
        <KRunTerminal
          v-if="open"
          :key="terminalService"
          :run-id="runId"
          :service="terminalService"
        />
      </div>
    </template>
    <template
      v-if="sshInfo?.sshCommands"
      #footer
    >
      <div class="flex w-full items-center justify-between gap-2">
        <span class="text-2xs text-dimmed">Prefer your own terminal?</span>
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          icon="i-lucide-copy"
          label="Copy SSH command"
          @click="copySshCommand"
        />
      </div>
    </template>
  </UModal>
</template>
