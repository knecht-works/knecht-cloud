import type { RunStatus } from '~/utils/dashboard'

export interface TestRunRow {
  id: number
  projectId: number
  status: RunStatus
  log: string
  startedAt: string | number | null
  finishedAt: string | number | null
}

// The run's per-step execution records (run_steps): drives per-card status.
export interface TestRunStepRow {
  id: number
  stepIndex: number
  stepId: string
  type: string
  status: 'running' | 'success' | 'failed'
  parentStepId: string | null
  iteration: number | null
}

interface TestProject {
  id: number
  defaultBranch: string
}

// The workflow editor's inline test run: pick a project + branch, start a real
// run against the saved workflow, poll it while live. `onStarted` lets the
// page react when a test kicks off (it collapses the open step settings).
// `P` is the caller's project row shape (the picker binds the full row).
export function useWorkflowTestRun<P extends TestProject>(
  workflowName: () => string | undefined,
  onStarted?: () => void,
) {
  const toastError = useToastError()

  // The "Run" popover (project + branch picker together).
  const open = ref(false)
  const project = ref<P>()
  const starting = ref(false)
  const activeRun = ref<TestRunRow | null>(null)
  const activeRunSteps = ref<TestRunStepRow[]>([])

  // Branch the test runs against; follows the picked project (default = its
  // default branch) and offers that project's branches.
  const testBranch = ref<string>()
  watch(project, p => testBranch.value = p?.defaultBranch ?? 'main')
  const { items: testBranchItems } = useBranchPicker(
    () => project.value ? `/api/projects/${project.value.id}/branches` : null,
    () => project.value?.defaultBranch,
  )

  // Mock trigger-event data: a manual test fills {{ inputs.* }} with these, so
  // workflows built for triggers are testable without one. Empty fields are
  // omitted; kept across runs so retest exercises the same event.
  const mockInputs = reactive<Record<string, string>>({})
  const filledInputs = () => {
    const filled = Object.fromEntries(Object.entries(mockInputs).filter(([, v]) => v.trim()))
    return Object.keys(filled).length ? filled : undefined
  }

  async function start() {
    const workflow = workflowName()
    if (!project.value || !workflow) return
    starting.value = true
    try {
      activeRun.value = await $fetch<TestRunRow>('/api/runs', {
        method: 'POST',
        body: { projectId: project.value.id, workflow, branch: testBranch.value, inputs: filledInputs() },
      })
      activeRunSteps.value = []
      open.value = false
      onStarted?.()
    }
    catch (e) {
      toastError('Failed to start test', e)
    }
    finally {
      starting.value = false
    }
  }

  usePollWhile(
    () => !!activeRun.value && isLiveStatus(activeRun.value.status),
    async () => {
      if (!activeRun.value) return
      const id = activeRun.value.id
      ;[activeRun.value, activeRunSteps.value] = await Promise.all([
        $fetch<TestRunRow>(`/api/runs/${id}`),
        $fetch<TestRunStepRow[]>(`/api/runs/${id}/steps`),
      ])
    },
  )

  // Re-attach to a live run of this workflow, so navigating away and back
  // doesn't lose an in-flight run's progress. Only live runs are restored
  // (the newest one); runs that finished while away stay on the runs page.
  async function reattach() {
    const workflow = workflowName()
    if (!workflow) return
    try {
      const runs = await $fetch('/api/runs')
      const live = runs.find(r => r.workflow === workflow && isLiveStatus(r.status))
      if (!live || activeRun.value) return
      ;[activeRun.value, activeRunSteps.value] = await Promise.all([
        $fetch<TestRunRow>(`/api/runs/${live.id}`),
        $fetch<TestRunStepRow[]>(`/api/runs/${live.id}/steps`),
      ])
    }
    catch { /* nothing to restore */ }
  }

  watch(workflowName, () => {
    detach()
    reattach()
  }, { immediate: true })

  // A run cancelled from elsewhere (the run detail page) leaves test mode too.
  watch(() => activeRun.value?.status, (status) => {
    if (status === 'cancelled') detach()
  })

  function detach() {
    activeRun.value = null
    activeRunSteps.value = []
  }

  // Actually stop the run server-side, then return the editor to edit mode.
  const cancelling = ref(false)
  async function cancel() {
    if (!activeRun.value) return
    cancelling.value = true
    try {
      await $fetch(`/api/runs/${activeRun.value.id}/cancel`, { method: 'POST' })
      detach()
    }
    catch (e) {
      toastError('Failed to cancel', e)
    }
    finally {
      cancelling.value = false
    }
  }

  // Resume the failed run from the step that stopped it (completed steps keep
  // their results); polling picks the run back up as it goes live again.
  const retrying = ref(false)
  async function retry() {
    if (!activeRun.value) return
    retrying.value = true
    try {
      activeRun.value = await $fetch<TestRunRow>(`/api/runs/${activeRun.value.id}/retry`, { method: 'POST' })
    }
    catch (e) {
      toastError('Failed to retry', e)
    }
    finally {
      retrying.value = false
    }
  }

  async function retest() {
    const workflow = workflowName()
    if (!activeRun.value || !workflow) return
    const projectId = activeRun.value.projectId
    detach()
    try {
      activeRun.value = await $fetch<TestRunRow>('/api/runs', {
        method: 'POST',
        body: { projectId, workflow, inputs: filledInputs() },
      })
    }
    catch { /* surfaced via the run page if it fails to start */ }
  }

  return { open, project, starting, activeRun, activeRunSteps, testBranch, testBranchItems, mockInputs, start, detach, retest, cancel, cancelling, retry, retrying }
}
