<script setup lang="ts">
import { PUBLISH_FOLLOWUP_PROMPT } from '#shared/utils/followup'
import { stepsInclude, type Step } from '#shared/utils/workflow'

const route = useRoute()
const toastError = useToastError()
const id = Number(route.params.id)
const NuxtLink = resolveComponent('NuxtLink')

const { data: run, refresh } = await useFetch(`/api/runs/${id}`)
const { data: stepRows, refresh: refreshSteps } = await useFetch(`/api/runs/${id}/steps`)
const { data: followups, refresh: refreshFollowups } = await useFetch(`/api/runs/${id}/followups`)

const isLive = computed(() => isLiveStatus(run.value?.status))

// A boot step in the pinned sequence means a preview is coming: the preview
// frame is shown (in its booting state) from the start of the run, so the
// layout doesn't jump when the env comes up mid-run.
const hasBootStep = computed(() =>
  stepsInclude((run.value?.steps ?? []) as Step[], 'ddev-start'))
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
    const prompt = typeof s.params?.prompt === 'string' ? s.params.prompt : null
    return {
      ...s,
      depth: depthOf(s),
      icon: s.origin === 'followup' ? 'i-lucide-message-circle-reply' : (def?.icon ?? 'i-lucide-square'),
      label: s.origin === 'followup' ? 'Follow-up' : (def?.label ?? s.type),
      snippet: prompt === PUBLISH_FOLLOWUP_PROMPT ? 'Open a PR' : prompt,
      color: STEP_KIND_COLOR[def?.kind ?? 'det'],
      statusMeta: RUN_STATUS_META[s.status],
    }
  })
})

// Step details (prompt, output, log) are heavier than the polled list, so they
// load lazily when a timeline row is expanded; while the run or a follow-up is
// live, the poll re-fetches expanded rows so an open step's log streams.
type StepDetail = {
  id: number
  params: Record<string, unknown> | null
  outputs: Record<string, unknown> | null
  log: string
  error: string | null
}
const expandedSteps = ref(new Set<number>())
const stepDetails = ref(new Map<number, StepDetail>())
async function toggleStep(rowId: number) {
  if (expandedSteps.value.has(rowId)) {
    expandedSteps.value.delete(rowId)
    return
  }
  expandedSteps.value.add(rowId)
  if (!stepDetails.value.has(rowId)) await refreshStepDetail(rowId)
}
async function refreshStepDetail(rowId: number) {
  try {
    stepDetails.value.set(rowId, await $fetch<StepDetail>(`/api/runs/${id}/steps/${rowId}`))
  }
  catch {
    // The row can vanish under us (e.g. a retry reset the tail); the poll's
    // refreshSteps removes it from the timeline anyway.
  }
}

// What an expanded row shows, as labeled text blocks: the prompt (ai and
// follow-up steps) gets its own block, the remaining params render as JSON,
// the output as text when the step produced text and as JSON otherwise. The
// log is separate (KLogView).
function detailSections(detail: StepDetail): { label: string, text: string, mono?: boolean, error?: boolean }[] {
  const sections = []
  const { prompt, ...params } = detail.params ?? {}
  if (typeof prompt === 'string') sections.push({ label: 'Prompt', text: prompt })
  if (Object.keys(params).length) sections.push({ label: 'Params', text: JSON.stringify(params, null, 2), mono: true })
  const outputs = detail.outputs ?? {}
  if (typeof outputs.text === 'string') sections.push({ label: 'Output', text: outputs.text })
  else if (Object.keys(outputs).length) sections.push({ label: 'Output', text: JSON.stringify(outputs, null, 2), mono: true })
  if (detail.error) sections.push({ label: 'Error', text: detail.error, error: true })
  return sections
}

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
// ('down') can't be rebooted (its sandbox and checkout are gone), so re-running
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
const { data: settings } = await useFetch('/api/settings')
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
const terminalHint = computed(() =>
  run.value?.envState === 'archived' ? 'Restore the environment first' : 'Reboot the environment first')
const terminalServices = computed(() => sshInfo.value?.services ?? [])

// Fetched before the modal opens so the picker and footer don't pop in
// after the fact; the button shows a spinner meanwhile.
const openingTerminal = ref(false)
async function openTerminal() {
  terminalService.value = 'web'
  openingTerminal.value = true
  try {
    sshInfo.value = await $fetch<SshInfo>(`/api/runs/${id}/ssh`)
  }
  catch {
    // The terminal itself still works; only the picker/footer stay bare.
    sshInfo.value = { services: ['web'], sshCommands: null }
  }
  finally {
    openingTerminal.value = false
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
const openingVscode = ref(false)
async function openInVscode() {
  openingVscode.value = true
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
  finally {
    openingVscode.value = false
  }
}
const followupPrompt = ref('')
const followupPush = ref(true)
const sendingFollowup = ref(false)
// One flag for everything the composer disables on.
const followupLocked = computed(() => !aiConfigured.value || followupActive.value || sendingFollowup.value)
async function sendFollowup(prompt: string, push: boolean) {
  const text = prompt.trim()
  if (!text || sendingFollowup.value) return
  sendingFollowup.value = true
  try {
    await $fetch(`/api/runs/${id}/followups`, { method: 'POST', body: { prompt: text, push } })
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
  ...[...expandedSteps.value].map(rowId => refreshStepDetail(rowId)),
]))
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
        <UTooltip
          v-if="run.envState !== 'down'"
          :text="terminalHint"
          :disabled="canTerminal"
        >
          <!-- The span keeps the tooltip hoverable while the button is disabled. -->
          <span>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-square-terminal"
              label="Terminal"
              :disabled="!canTerminal"
              :loading="openingTerminal"
              @click="openTerminal"
            />
          </span>
        </UTooltip>
        <UTooltip
          v-if="run.envState !== 'down'"
          :text="terminalHint"
          :disabled="canTerminal"
        >
          <span>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-code"
              label="Open in VS Code"
              :disabled="!canTerminal"
              :loading="openingVscode"
              @click="openInVscode"
            />
          </span>
        </UTooltip>
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

      <!-- The frame is present from the run's first render whenever a boot
           step is coming, so nothing jumps into place when the env comes up:
           it just fills in. -->
      <KPreviewBrowser
        v-if="run.envState === 'up' || (isLive && hasBootStep)"
        :run-id="run.id"
        :hosts="run.previewHosts ?? []"
        :online="run.envState === 'up' && run.previewReady"
        :booting="isLive"
      >
        <p class="max-w-70 text-2sm text-muted">
          The boot step didn't finish, so this run has no preview. Retry the run to boot it.
        </p>
      </KPreviewBrowser>

      <div
        v-else-if="run.envState === 'stopped' || run.envState === 'archived'"
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
              to="/settings"
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
            @click="sendFollowup(PUBLISH_FOLLOWUP_PROMPT, true)"
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
          @submit="sendFollowup(followupPrompt, followupPush)"
        >
          <UChatPromptSubmit
            color="primary"
            :disabled="followupLocked || !followupPrompt.trim()"
          />
          <template #footer>
            <label class="flex items-center gap-2">
              <KToggle
                :active="followupPush"
                :disabled="followupLocked"
                aria-label="Push changes after the follow-up"
                @toggle="followupPush = !followupPush"
              />
              <span class="text-xs text-muted">Push changes</span>
            </label>
          </template>
        </UChatPrompt>
      </KPanel>

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
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4.5 py-3 text-left transition-colors hover:bg-elevated/50"
              :style="s.depth ? { paddingLeft: `${18 + s.depth * 26}px` } : undefined"
              :aria-expanded="expandedSteps.has(s.id)"
              @click="toggleStep(s.id)"
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
                  v-if="s.snippet"
                  class="truncate text-xs text-muted"
                >
                  {{ s.snippet }}
                </p>
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
              <UIcon
                name="i-lucide-chevron-down"
                class="size-3.5 shrink-0 text-dimmed transition-transform"
                :class="expandedSteps.has(s.id) ? 'rotate-180' : ''"
              />
            </button>
            <div
              v-if="expandedSteps.has(s.id)"
              class="border-t border-muted px-4.5 py-4"
              :style="s.depth ? { paddingLeft: `${18 + s.depth * 26}px` } : undefined"
            >
              <div
                v-if="stepDetails.get(s.id)"
                class="flex flex-col gap-4"
              >
                <div
                  v-for="section in detailSections(stepDetails.get(s.id)!)"
                  :key="section.label"
                >
                  <p class="k-mono mb-1.5 text-3xs uppercase tracking-wide text-dimmed">
                    {{ section.label }}
                  </p>
                  <p
                    class="whitespace-pre-wrap text-xs"
                    :class="[section.mono ? 'k-mono' : '', section.error ? '' : 'text-muted']"
                    :style="section.error ? 'color: var(--status-error)' : undefined"
                  >
                    {{ section.text }}
                  </p>
                </div>
                <div v-if="stepDetails.get(s.id)!.log">
                  <p class="k-mono mb-1.5 text-3xs uppercase tracking-wide text-dimmed">
                    Log
                  </p>
                  <KLogView
                    :log="stepDetails.get(s.id)!.log"
                    :max-height="260"
                    class="text-xs leading-loose"
                  />
                </div>
                <p
                  v-if="!stepDetails.get(s.id)!.log && !detailSections(stepDetails.get(s.id)!).length"
                  class="text-xs text-dimmed"
                >
                  This step recorded no details.
                </p>
              </div>
              <p
                v-else
                class="text-xs text-dimmed"
              >
                Loading…
              </p>
            </div>
          </li>
        </ul>
      </KPanel>

      <KPanel
        title="Log"
        icon="i-lucide-terminal"
        :pad="0"
        collapsible
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
</template>
