import { useToastError } from '~/composables/useToastError'
import { ref } from 'vue'
import { $fetch } from '#imports'

export function useStartRun(projectId: number, onStarted: (runId: number) => void | Promise<void>) {
  const toastError = useToastError()
  const starting = ref(false)

  async function launch(request: () => Promise<{ id: number }>, failure: string) {
    starting.value = true
    try {
      const created = await request()
      await onStarted(created.id)
    }
    catch (e) {
      toastError(failure, e)
    }
    finally {
      starting.value = false
    }
  }

  function start(workflowId: number, branch: string) {
    return launch(() => $fetch('/api/runs', {
      method: 'POST',
      body: { projectId, workflowId, branch },
    }), 'Failed to start run')
  }

  function startSession(branch: string, preview: boolean) {
    return launch(() => $fetch(`/api/projects/${projectId}/sessions`, {
      method: 'POST',
      body: { branch, preview },
    }), 'Failed to start session')
  }

  return { starting, start, startSession }
}
