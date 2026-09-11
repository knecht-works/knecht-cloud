import type { RunStatus } from '~/utils/dashboard'

export interface TestRunRow {
  id: number
  projectId: number
  status: RunStatus
  log: string
  startedAt: string | number | null
  finishedAt: string | number | null
}

export interface TestRunStepRow {
  id: number
  stepIndex: number
  stepId: string
  type: string
  origin: 'workflow' | 'followup'
  params: Record<string, unknown> | null
  status: 'running' | 'success' | 'failed'
  error: string | null
  attempt: number
  parentStepId: string | null
  iteration: number | null
  logStart: number | null
  startedAt: string | number | null
  finishedAt: string | number | null
}

interface TestProject {
  id: number
  defaultBranch: string
}

export function useWorkflowTestRun<P extends TestProject>(
  workflowId: () => number | undefined,
  opts?: { beforeStart?: () => Promise<unknown>, onStarted?: () => void },
) {
  const toastError = useToastError()

  const open = ref(false)
  const project = ref<P>()
  const starting = ref(false)
  const activeRun = ref<TestRunRow | null>(null)
  const activeRunSteps = ref<TestRunStepRow[]>([])

  const testBranch = ref<string>()
  watch(project, p => testBranch.value = p?.defaultBranch ?? 'main')
  const { items: testBranchItems } = useBranchPicker(
    () => project.value ? `/api/projects/${project.value.id}/branches` : null,
    () => project.value?.defaultBranch,
  )

  const mockInputs = reactive<Record<string, string>>({})
  const filledInputs = () => {
    const filled = Object.fromEntries(Object.entries(mockInputs).filter(([, v]) => v.trim()))
    return Object.keys(filled).length ? filled : undefined
  }

  async function start() {
    const id = workflowId()
    if (!project.value || !id) return
    starting.value = true
    try {
      await opts?.beforeStart?.()
      activeRun.value = await $fetch<TestRunRow>('/api/runs', {
        method: 'POST',
        body: { projectId: project.value.id, workflowId: id, branch: testBranch.value, inputs: filledInputs() },
      })
      activeRunSteps.value = []
      open.value = false
      opts?.onStarted?.()
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

  async function reattach() {
    const id = workflowId()
    if (!id) return
    try {
      const runs = await $fetch('/api/runs')
      const live = runs.find(r => r.workflowId === id && isLiveStatus(r.status))
      if (!live || activeRun.value) return
      ;[activeRun.value, activeRunSteps.value] = await Promise.all([
        $fetch<TestRunRow>(`/api/runs/${live.id}`),
        $fetch<TestRunStepRow[]>(`/api/runs/${live.id}/steps`),
      ])
    }
    catch { /* nothing to restore */ }
  }

  watch(workflowId, () => {
    detach()
    reattach()
  }, { immediate: true })

  watch(() => activeRun.value?.status, (status) => {
    if (status === 'cancelled') detach()
  })

  function detach() {
    activeRun.value = null
    activeRunSteps.value = []
  }

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
    const id = workflowId()
    if (!activeRun.value || !id) return
    const projectId = activeRun.value.projectId
    detach()
    try {
      await opts?.beforeStart?.()
      activeRun.value = await $fetch<TestRunRow>('/api/runs', {
        method: 'POST',
        body: { projectId, workflowId: id, inputs: filledInputs() },
      })
    }
    catch (e) {
      toastError('Failed to start test', e)
    }
  }

  return { open, project, starting, activeRun, activeRunSteps, testBranch, testBranchItems, mockInputs, start, detach, retest, cancel, cancelling, retry, retrying }
}
