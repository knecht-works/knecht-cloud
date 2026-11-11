import type { Ref } from 'vue'

export function useProjectDump<T extends { id: number, dbDumpPath: string | null }>(
  project: Ref<T | null | undefined>,
) {
  const toast = useToast()
  const toastError = useToastError()
  const uploading = ref(false)
  const dumpName = computed(() => project.value?.dbDumpPath?.split('/').pop() ?? null)

  async function upload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || !project.value) return
    uploading.value = true
    try {
      project.value = await $fetch(`/api/projects/${project.value.id}/dump`, {
        method: 'POST',
        query: { name: file.name },
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      }) as T
      toast.add({ title: 'Database dump uploaded', color: 'success' })
    }
    catch (e) {
      toastError('Upload failed', e)
    }
    finally {
      uploading.value = false
      input.value = ''
    }
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

  return { uploading, dumpName, upload, remove }
}
