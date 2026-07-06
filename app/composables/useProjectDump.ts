import type { Ref } from 'vue'

// Upload/remove a project's DB dump (setup wizard + project detail page).
// `project` is the writable ref holding the project row: the dump endpoints
// return the updated row, which is written straight back into it.
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
      const form = new FormData()
      form.append('file', file)
      project.value = await $fetch(`/api/projects/${project.value.id}/dump`, { method: 'POST', body: form }) as T
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
