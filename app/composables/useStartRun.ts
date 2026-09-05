// Start a manual run of a workflow on a project: the POST plus the
// in-flight flag the buttons disable on. Shared by the project header's
// "Start workflow" picker and the automation panel's play buttons, so a
// run started anywhere on the page resolves the same way.
export function useStartRun(projectId: number, onStarted: (runId: number) => void | Promise<void>) {
  const toastError = useToastError()
  const starting = ref(false)

  async function start(workflowId: number, branch: string) {
    starting.value = true
    try {
      const created = await $fetch('/api/runs', {
        method: 'POST',
        body: { projectId, workflowId, branch },
      })
      await onStarted(created.id)
    }
    catch (e) {
      toastError('Failed to start run', e)
    }
    finally {
      starting.value = false
    }
  }

  return { starting, start }
}
