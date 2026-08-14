<script setup lang="ts">
import { PUBLISH_FOLLOWUP_PROMPT } from '#shared/utils/followup'
import { stepsInclude, type Step } from '#shared/utils/workflow'

// One run's full workspace: preview, follow-up chat, the run log as one
// continuous stream with a step index rail beside it (KRunLog: clicking a
// step scrolls the log to that step's byte offset) and the run-level actions
// (terminal, IDE, PR, cancel/retry, delete). Rendered inside the project
// page for the selected run; the parent keys this component by runId so
// switching runs remounts everything (preview history, terminal, fetches)
// from scratch.
const props = defineProps<{ runId: number }>()

const emit = defineEmits<{
  /** The run was deleted; the parent picks the next run. */
  deleted: []
  /** "Run again" created a fresh run; the parent selects it. */
  started: [runId: number]
  /** Cancel/retry/reboot changed the run's status or env state; the parent
   *  refreshes its runs list so the sidebar row matches. */
  changed: []
}>()

const toastError = useToastError()
const id = props.runId
const NuxtLink = resolveComponent('NuxtLink')

// Lazy (not awaited): the component mounts client-side whenever the selected
// run changes, and a blocking async setup would re-trigger Suspense on every
// switch. The template guards on `run` instead.
const { data: run, refresh } = useFetch(`/api/runs/${id}`, { lazy: true })
const { data: stepRows, refresh: refreshSteps } = useFetch(`/api/runs/${id}/steps`, { lazy: true })
const { data: followups, refresh: refreshFollowups } = useFetch(`/api/runs/${id}/followups`, { lazy: true })

const isLive = computed(() => isLiveStatus(run.value?.status))

// A boot step in the pinned sequence means a preview is coming; without one
// (a workflow that never boots an env) the preview frame isn't rendered at
// all.
const hasBootStep = computed(() =>
  stepsInclude((run.value?.steps ?? []) as Step[], 'ddev-start'))
const statusMeta = computed(() => run.value ? RUN_STATUS_META[run.value.status] : IDLE_STATUS_META)

// Browsable only once the boot step finished (previewReady), not the moment
// the containers run.
const previewOnline = computed(() =>
  run.value?.envState === 'up' && run.value.previewReady)

// The step timeline behind KRunLog, shared with the workflow editor's test
// run (utils/run-log.ts).
const timeline = computed(() => runLogTimeline(stepRows.value ?? []))

// The step behind the failure card: rows are in execution order, so the last
// row carrying an error is the most specific one (a composite is finalized
// after the child that failed it). Null when the run failed before any step
// recorded an error (e.g. a runner crash); the card then points at the log.
const failedStep = computed(() => {
  if (run.value?.status !== 'failed') return null
  return [...timeline.value].reverse().find(s => s.error) ?? null
})

// The run's meta facts (the workflow it executes, how it was triggered, the
// branch it works on, timing). Chips are skipped when a run predates the
// recorded field. The workflow chip links to the editor (plain text once the
// workflow was deleted). The PR gets no chip: the header's "Open Pull
// Request" button already covers it.
const meta = computed(() => {
  const r = run.value
  if (!r) return []
  const trigger = r.trigger ? triggerSourceMeta(r.trigger) : null
  return [
    { icon: 'i-lucide-workflow', text: r.workflow, href: r.workflowId ? `/workflows/${r.workflowId}` : undefined },
    trigger && { icon: trigger.icon, text: trigger.label },
    r.branch && { icon: 'i-lucide-git-branch', text: r.branch },
    r.startedAt && { icon: 'i-lucide-timer', text: runDuration(r.startedAt, r.finishedAt) },
    r.createdAt && { icon: 'i-lucide-calendar', text: timeAgo(r.createdAt) },
  ].filter(Boolean) as { icon: string, text: string, href?: string }[]
})

const confirmDelete = ref(false)
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/runs/${id}`, { method: 'DELETE' })
    emit('deleted')
  }
  catch (e) {
    deleting.value = false
    toastError('Delete failed', e)
  }
}

// Start the same workflow on the same project as a NEW run. A torn-down env
// ('down') can't be rebooted (its sandbox and checkout are gone), so re-running
// is the way to get a fresh preview. Deliberately does not reuse run.branch:
// a create-branch step overwrote it with the run's own work branch.
const restarting = ref(false)
async function runAgain() {
  if (!run.value?.workflowId) return
  restarting.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: run.value.projectId, workflowId: run.value.workflowId },
    })
    emit('started', created.id)
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
    emit('changed')
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
    emit('changed')
  }
  catch (e) {
    toastError('Retry failed', e)
  }
  finally {
    retrying.value = false
  }
}

// Walk the env DOWN its lifecycle on demand (stop exports the database and
// frees the containers, archive snapshots and deletes the heavy sandbox);
// the reverse steps (reboot/restore) live inside the preview frame.
async function envAction(action: 'stop' | 'archive') {
  try {
    run.value = await $fetch(`/api/runs/${id}/${action}`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError(action === 'stop' ? 'Stop failed' : 'Archive failed', e)
  }
}

const rebooting = ref(false)
async function reboot() {
  rebooting.value = true
  try {
    run.value = await $fetch(`/api/runs/${id}/reboot`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError(run.value?.envState === 'archived' ? 'Restore failed' : 'Reboot failed', e)
  }
  finally {
    rebooting.value = false
  }
}

// Follow-ups: send a tweak prompt to the finished run; the agent continues
// the run's opencode session in the run's existing sandbox. One at a time per
// run; while one is queued (env reviving) or running, the composer locks and
// polling keeps the log/timeline live.
const followupActive = computed(() =>
  (followups.value ?? []).some(f => f.status === 'queued' || f.status === 'running'))
const canFollowup = computed(() => {
  const r = run.value
  return Boolean(r && (r.status === 'success' || r.status === 'failed') && r.envState !== 'down')
})
const followupHint = computed(() => {
  if (run.value?.envState === 'stopped') return 'The environment reboots first (a few seconds).'
  if (run.value?.envState === 'archived') return 'The environment is restored first (a few minutes).'
  return null
})

// Follow-ups run the agent, so without a provider key (Settings → Agent) the
// composer is disabled instead of letting the follow-up fail at execution.
const { data: settings } = useSettings()
const aiConfigured = computed(() => !!settings.value?.aiKeyConfigured)

// Remote access: the web terminal (any member, no setting needed) plus the
// ssh command and VS Code link (need the sshTarget setting). The ssh endpoint
// is fetched on click, not polled: it does one-shot docker calls.
interface SshInfo { services: string[], sshCommands: Record<string, string> | null }
const toast = useToast()
const terminalOpen = ref(false)
const terminalService = ref('web')
const sshInfo = ref<SshInfo | null>(null)
const canTerminal = computed(() => run.value?.envState === 'up')
const terminalServices = computed(() => sshInfo.value?.services ?? [])

// Fetched before the modal opens so the picker and footer don't pop in
// after the fact.
async function openTerminal() {
  terminalService.value = 'web'
  try {
    sshInfo.value = await $fetch<SshInfo>(`/api/runs/${id}/ssh`)
  }
  catch {
    // The terminal itself still works; only the picker/footer stay bare.
    sshInfo.value = { services: ['web'], sshCommands: null }
  }
  terminalOpen.value = true
}

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

// The web IDE: openvscode-server inside the run's web container, on its own
// preview origin. The tab opens synchronously (popup blockers kill windows
// opened after an await) and navigates once the server confirms it is up.
async function openInVscode() {
  const tab = window.open('about:blank', '_blank')
  try {
    const { url } = await $fetch<{ url: string }>(`/api/runs/${id}/ide`, { method: 'POST' })
    if (tab) tab.location.href = url
    else window.open(url, '_blank')
  }
  catch (e) {
    tab?.close()
    toastError('Could not open the IDE', e)
  }
}

// The header's overflow menu: the terminal while the env still exists
// (disabled until it is up again; the web IDE sits in the header as its own
// button); the on-demand lifecycle steps down (stop, archive) for whichever
// one applies; delete stays separate as the destructive tail.
const menuItems = computed(() => {
  const remote = run.value?.envState !== 'down'
    ? [{
        label: 'Terminal',
        icon: 'i-lucide-square-terminal',
        disabled: !canTerminal.value,
        onSelect: openTerminal,
      }]
    : []
  const lifecycle = run.value?.envState === 'up' && !isLive.value
    ? [{ label: 'Stop environment', icon: 'i-lucide-power-off', onSelect: () => envAction('stop') }]
    : run.value?.envState === 'stopped'
      ? [{ label: 'Archive environment', icon: 'i-lucide-archive', onSelect: () => envAction('archive') }]
      : []
  return [remote, lifecycle, [{
    label: 'Delete run',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { confirmDelete.value = true },
  }]]
})
const followupPrompt = ref('')
const sendingFollowup = ref(false)
// One flag for everything the composer disables on.
const followupLocked = computed(() => !aiConfigured.value || followupActive.value || sendingFollowup.value)
async function sendFollowup(prompt: string) {
  const text = prompt.trim()
  if (!text || sendingFollowup.value) return
  sendingFollowup.value = true
  try {
    await $fetch(`/api/runs/${id}/followups`, { method: 'POST', body: { prompt: text } })
    followupPrompt.value = ''
    await Promise.all([refresh(), refreshSteps(), refreshFollowups()])
  }
  catch (e) {
    toastError('Follow-up failed', e)
  }
  finally {
    sendingFollowup.value = false
  }
}

// Stop the active follow-up: the row flips server-side (the composer unlocks
// right away), the executor kills the in-flight agent command.
const stoppingFollowup = ref(false)
async function stopFollowup() {
  if (stoppingFollowup.value) return
  stoppingFollowup.value = true
  try {
    await $fetch(`/api/runs/${id}/followups/cancel`, { method: 'POST' })
    await Promise.all([refresh(), refreshSteps(), refreshFollowups()])
  }
  catch (e) {
    toastError('Stop failed', e)
  }
  finally {
    stoppingFollowup.value = false
  }
}

// The follow-ups as a chat transcript for UChatMessages: each follow-up is a
// user message (the prompt) plus, once finished, an assistant message (the
// agent's clean reply pulled from the opencode session, or the failure). The
// canned publish prompt renders under its button label instead of its full
// text.
type ChatMessage = { id: string, role: 'user' | 'assistant', parts: { type: 'text', text: string }[] }
const chatMessages = computed<ChatMessage[]>(() => (followups.value ?? []).flatMap((f) => {
  const messages: ChatMessage[] = [{
    id: `followup-${f.id}-prompt`,
    role: 'user',
    parts: [{ type: 'text', text: f.prompt === PUBLISH_FOLLOWUP_PROMPT ? 'Open a PR' : f.prompt }],
  }]
  // Follow-ups from before the clean-reply extraction stored the raw stream;
  // stripping ANSI codes keeps them readable.
  const reply = f.status === 'failed'
    ? `✗ ${f.error ?? 'Follow-up failed'}`
    // eslint-disable-next-line no-control-regex
    : f.status === 'success' ? (f.response ?? 'Done.').replace(/\u001B\[[0-9;]*m/g, '') : null
  if (reply) {
    messages.push({ id: `followup-${f.id}-reply`, role: 'assistant', parts: [{ type: 'text', text: reply }] })
  }
  return messages
}))
// 'submitted' keeps UChatMessages' typing indicator up while a follow-up is
// queued (env reviving) or running.
const chatStatus = computed(() => followupActive.value ? 'submitted' as const : 'ready' as const)

// Renders a bubble's text (the #content slot types its message loosely, so
// newlines would collapse without this pre-wrap hook).
function messageText(message: { parts: { type: string, text?: string }[] }): string {
  return message.parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('')
}

// The "Open a PR" skill: a canned follow-up for runs that never decided where
// to commit (no PR yet). The agent reviews its own work, commits in logical
// chunks and opens an informed PR (shared/utils/followup.ts).
const publishable = computed(() => canFollowup.value && !run.value?.prUrl)

usePollWhile(() => isLive.value || followupActive.value, () => Promise.all([
  refresh(),
  refreshSteps(),
  refreshFollowups(),
]))
</script>

<template>
  <!-- min-w-0: as a grid item in the project page's [1fr|sidebar] grid, the
       default min-width:auto would let one long unbroken log line widen the
       1fr track past the viewport and push the sidebar off-screen. -->
  <div
    v-if="run"
    class="flex min-w-0 flex-col gap-4.5"
  >
    <!-- Compact run header: identity + meta left, run-level actions right.
         The page-level chrome (breadcrumbs, project title) is the parent's. -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2.5">
          <h2 class="k-mono text-lg font-semibold tracking-tight text-highlighted">
            Run #{{ run.id }}
          </h2>
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
        <div
          v-if="meta.length"
          class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2"
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
      </div>
      <div class="flex flex-none items-center gap-2">
        <!-- Jump into the run's code. Starting runs is the project header's
             job ("Start workflow" and the Automation panel), so the run
             header offers no run-again; a torn-down env keeps its run-again
             inside the preview frame. -->
        <UButton
          v-if="!isLive && run.envState !== 'down'"
          color="neutral"
          variant="outline"
          icon="i-lucide-code"
          label="Open in IDE"
          :disabled="!canTerminal"
          @click="openInVscode"
        />
        <UButton
          v-if="run.prUrl"
          color="primary"
          icon="i-lucide-git-pull-request"
          label="Open Pull Request"
          :to="run.prUrl"
          target="_blank"
        />
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
      </div>
    </div>

    <!-- The preview anchors the workspace whenever the workflow boots an env;
         a workflow without a boot step gets no preview frame at all. While it
         is offline, the env's lifecycle state (stopped/archived/gone) renders
         inside the frame with its revival action instead of a separate card. -->
    <KPreviewBrowser
      v-if="hasBootStep"
      :run-id="run.id"
      :hosts="run.previewHosts ?? []"
      :online="previewOnline"
      :booting="isLive"
    >
      <template v-if="run.envState === 'stopped'">
        <p class="max-w-100 text-2sm text-muted">
          The environment was stopped after being idle. Reboot it to preview again.
        </p>
        <UButton
          color="primary"
          label="Reboot"
          icon="i-lucide-power"
          :loading="rebooting"
          @click="reboot"
        />
      </template>
      <template v-else-if="run.envState === 'archived'">
        <p class="max-w-100 text-2sm text-muted">
          This environment was archived. Its exact code state and database are kept,
          and restoring rebuilds it in a few minutes.
        </p>
        <UButton
          color="primary"
          label="Restore"
          icon="i-lucide-archive-restore"
          :loading="rebooting"
          @click="reboot"
        />
      </template>
      <template v-else-if="run.envState === 'down'">
        <p class="max-w-100 text-2sm text-muted">
          This run's environment and its archive are gone, so there is nothing left to
          restore. Run the workflow again to get a fresh environment.
        </p>
        <UTooltip
          text="The workflow was deleted"
          :disabled="!!run.workflowId"
        >
          <UButton
            color="primary"
            label="Run again"
            icon="i-lucide-play"
            :loading="restarting"
            :disabled="!run.workflowId"
            @click="runAgain"
          />
        </UTooltip>
      </template>
      <template v-else>
        <p class="max-w-70 text-2sm text-muted">
          The boot step didn't finish, so this run has no preview. Retry the run to boot it.
        </p>
      </template>
    </KPreviewBrowser>

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
          v-if="run.workflowId"
          color="neutral"
          variant="outline"
          icon="i-lucide-workflow"
          :label="failedStep ? 'Fix failed step' : 'Edit workflow'"
          :to="`/workflows/${run.workflowId}${failedStep ? `?step=${encodeURIComponent(failedStep.stepId)}` : ''}`"
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

    <KPanel
      v-if="canFollowup"
      title="Follow-up"
      icon="i-lucide-message-circle-reply"
    >
      <p class="mb-3 text-2sm text-muted">
        Tell the agent what to tweak: it continues this run's session in the
        run's own environment.
        <span v-if="!aiConfigured">
          Add your AI provider key under
          <NuxtLink
            to="/settings/agent"
            class="text-toned underline underline-offset-2"
          >Settings → Agent</NuxtLink>
          first.
        </span>
        <span v-else-if="followupHint"> {{ followupHint }}</span>
      </p>
      <div
        v-if="chatMessages.length || followupActive"
        class="mb-4 max-h-100 overflow-y-auto"
      >
        <UChatMessages
          :messages="chatMessages"
          :status="chatStatus"
          should-auto-scroll
          :assistant="{ avatar: { src: '/mascot/knecht-avatar.svg', alt: 'Knecht' } }"
        >
          <template #content="{ message }">
            <ChatComark
              v-if="message.role === 'assistant'"
              :markdown="messageText(message)"
            />
            <p
              v-else
              class="whitespace-pre-wrap"
            >
              {{ messageText(message) }}
            </p>
          </template>
        </UChatMessages>
      </div>
      <div
        v-if="publishable"
        class="mb-2"
      >
        <UButton
          color="neutral"
          variant="outline"
          size="xs"
          class="rounded-full"
          icon="i-lucide-git-pull-request"
          label="Open a PR"
          :disabled="followupLocked"
          @click="sendFollowup(PUBLISH_FOLLOWUP_PROMPT)"
        />
      </div>
      <!-- No autofocus (Nuxt UI defaults it ON): the panel mounts the moment
           the run finishes, and stealing focus scrolls the page away from
           the freshly-loaded preview above. -->
      <UChatPrompt
        v-model="followupPrompt"
        :autofocus="false"
        placeholder="e.g. The button label should say 'Save changes' instead"
        :disabled="followupLocked"
        @submit="sendFollowup(followupPrompt)"
      >
        <!-- While a follow-up is active the submit button becomes a stop
             button (UChatPromptSubmit switches on status and emits stop). -->
        <UChatPromptSubmit
          color="primary"
          :status="chatStatus"
          :disabled="followupLocked || !followupPrompt.trim()"
          @stop="stopFollowup"
        />
      </UChatPrompt>
    </KPanel>

    <!-- The full run log, continuous, with a step index rail: clicking a
         step scrolls the log to that step's recorded byte offset. Nothing is
         hidden: retry banners, agent-git lines and the closing ✓/✗ sit in
         the segment they chronologically belong to. -->
    <KPanel
      title="Log"
      icon="i-lucide-list-checks"
      :pad="0"
    >
      <template #action>
        <span class="flex items-center gap-2">
          <KStatusDot
            :color="statusMeta.dot"
            :pulse="statusMeta.pulse"
            :size="6"
          />
          <span
            class="k-mono text-2xs"
            :style="{ color: statusMeta.text }"
          >{{ statusMeta.label }}</span>
        </span>
      </template>
      <KRunLog
        :log="run.log"
        :rows="timeline"
        :live="isLive || followupActive"
        :run-status="run.status"
        :run-started-at="run.startedAt"
        :run-finished-at="run.finishedAt"
      />
    </KPanel>

    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete run"
      :description="`Deletes run #${run.id} including its log and preview environment. This cannot be undone.`"
      confirm-label="Delete"
      :loading="deleting"
      @confirm="remove"
    />

    <UModal
      v-model:open="terminalOpen"
      :title="`Terminal · Run #${run.id}`"
      description="A shell inside the run's environment. Files and databases you touch here are the preview's."
      :ui="{ content: 'max-w-4xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <!-- Same pill pattern as the trigger modal's cron presets. -->
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
          <!-- Keyed per service: switching pills opens a fresh shell in that container. -->
          <KRunTerminal
            v-if="terminalOpen"
            :key="terminalService"
            :run-id="run.id"
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
  </div>
  <div
    v-else
    class="flex items-center justify-center py-16"
  >
    <UIcon
      name="i-lucide-loader-circle"
      class="size-5 animate-spin text-dimmed"
    />
  </div>
</template>
