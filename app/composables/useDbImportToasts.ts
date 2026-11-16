import { liveTopics } from '#shared/utils/live-topics'

interface ProjectBase {
  id: number
  fullName: string
  dbBase: { state: 'building' | 'ready' | 'failed', error?: string } | null
}

const building = new Set<number>()
let watching = false

// Only a build seen running in this tab reports its end, so a reload never repeats old results.
export function useDbImportToasts(): void {
  if (import.meta.server) return
  if (watching) return
  watching = true
  const toast = useToast()

  // One at a time: a slower, older answer would otherwise put a finished build back to running.
  let checking = Promise.resolve()
  const check = () => (checking = checking.then(compare))

  async function compare() {
    const projects = await $fetch<ProjectBase[]>('/api/projects').catch(() => null)
    if (!projects) return
    for (const project of projects) {
      const state = project.dbBase?.state
      if (state === 'building') {
        building.add(project.id)
        continue
      }
      if (!building.delete(project.id)) continue
      const to = `/projects/${project.id}/settings`
      if (state === 'ready') {
        toast.add({ title: 'Database imported', description: project.fullName, color: 'success', onClick: () => navigateTo(to) })
      }
      if (state === 'failed') {
        toast.add({
          title: 'Database import failed',
          description: `${project.fullName}: ${project.dbBase?.error}`,
          color: 'error',
          duration: 0,
          actions: [{ label: 'Retry', onClick: () => void $fetch(`/api/projects/${project.id}/db-base`, { method: 'POST' }).catch(() => {}) }],
        })
      }
    }
  }

  onNuxtReady(() => void check())
  onLiveTopics(() => [liveTopics.projects], check)
  onScopeDispose(() => {
    watching = false
  })
}
