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
