import type { Ref } from 'vue'
import { formatBytes } from '#shared/utils/bytes'
import { useToast } from '#imports'
import { useToastError } from '~/composables/useToastError'
import { computed } from 'vue'
import { useNow } from '~/composables/useNow'
import { useUploads } from '~/composables/useUploads'
import { $fetch } from '#build/fetch.mjs'

interface DbBaseState {
  state: 'building' | 'ready' | 'failed'
  step?: 'starting' | 'importing' | 'finishing'
  percent?: number
  importingSince?: string
}

export interface DumpProgress {
  step: string
  label: string
  percent: number
  detail: string
  short: string
}

export function useProjectDump<T extends { id: number, dbDumpPath: string | null, dbBase?: DbBaseState | null }>(
  project: Ref<T | null | undefined>,
) {
  const toast = useToast()
  const toastError = useToastError()
  const dumpName = computed(() => project.value?.dbDumpPath?.split('/').pop() ?? null)
  const uploadKey = computed(() => `dump:${project.value?.id}`)
  const uploadUrl = (file: File) => `/api/projects/${project.value?.id}/dump?name=${encodeURIComponent(file.name)}`
  const settingsPath = computed(() => `/projects/${project.value?.id}/settings`)
  const now = useNow()
  const { find: findUpload } = useUploads()
  const upload = computed(() => findUpload(uploadKey.value))

  const progress = computed((): DumpProgress | null => {
    if (upload.value) {
      const { loaded, total } = upload.value
      const percent = total ? Math.floor(loaded / total * 100) : 0
      return { step: '1/3', label: 'Uploading the dump', percent, detail: `${percent}% of ${formatBytes(total)} sent to the server`, short: `${percent}%` }
    }
    const base = project.value?.dbBase
    if (base?.state !== 'building') return null
    if (base.step === 'starting') {
      return { step: '2/3', label: 'Importing into the database', percent: 0, detail: 'Starting a fresh database for the import', short: '' }
    }
    if (base.step === 'finishing') {
      return { step: '3/3', label: 'Saving the database', percent: 100, detail: 'Writing everything to disk so every new environment starts from a clean copy', short: '' }
    }
    if (base.percent == null) {
      return { step: '2/3', label: 'Importing into the database', percent: 0, detail: 'Unpacking the dump before the import can start', short: '' }
    }
    return { step: '2/3', label: 'Importing into the database', percent: base.percent, detail: `${base.percent}% of the dump imported${timeLeft(base.percent, base.importingSince)}`, short: `${base.percent}%${timeLeft(base.percent, base.importingSince)}` }
  })

  function timeLeft(percent: number, since: string | undefined): string {
    if (!since || percent < 1) return ''
    const left = (now.value - new Date(since).getTime()) * (100 - percent) / percent / 60_000
    return left < 1 ? ' · under a minute left' : ` · about ${Math.round(left)} min left`
  }
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

  function cancel() {
    if (upload.value) upload.value.cancel()
    else void cancelBase()
  }

  return { dumpName, uploadKey, uploadUrl, settingsPath, upload, progress, uploaded, remove, rebuildBase, cancel }
}
