import type { Ref } from 'vue'

export function useProjectDump<T extends { id: number, dbDumpPath: string | null }>(
  project: Ref<T | null | undefined>,
) {
  const toast = useToast()
  const toastError = useToastError()
  const dumpName = computed(() => project.value?.dbDumpPath?.split('/').pop() ?? null)
  const uploadKey = computed(() => `dump:${project.value?.id}`)
  const uploadUrl = (file: File) => `/api/projects/${project.value?.id}/dump?name=${encodeURIComponent(file.name)}`
  const settingsPath = computed(() => `/projects/${project.value?.id}/settings`)
  const uploaded = (result: unknown) => {
    project.value = result as T
  }

  async function remove() {
    if (!project.value) return
    try {
      project.value = await $fetch(`/api/projects/${project.value.id}/dump`, { method: 'DELETE' }) as T
      toast.add({ title: 'Dump removed', color: 'success' })
    }
    catch (e) {
      toastError('Failed to remove dump', e)
    }
  }

  async function rebuildBase() {
    if (!project.value) return
    try {
      project.value = await $fetch(`/api/projects/${project.value.id}/db-base`, { method: 'POST' }) as T
    }
    catch (e) {
      toastError('Failed to start the import', e)
    }
  }

  async function cancelBase() {
    if (!project.value) return
    try {
      project.value = await $fetch(`/api/projects/${project.value.id}/db-base`, { method: 'DELETE' }) as T
    }
    catch (e) {
      toastError('Failed to cancel the import', e)
    }
  }

  return { dumpName, uploadKey, uploadUrl, settingsPath, uploaded, remove, rebuildBase, cancelBase }
}
