import { UProgress } from '#components'

export interface Upload {
  loaded: number
  total: number
  promise: Promise<unknown>
  cancel: () => void
}

export interface UploadRequest {
  key: string
  url: string
  file: File
  to?: string
}

// Module scope so an upload outlives the component that started it.
const uploads = shallowReactive(new Map<string, Upload>())

if (import.meta.client) {
  window.addEventListener('beforeunload', (e) => {
    if (uploads.size) e.preventDefault()
  })
}

export function useUploads() {
  const toast = useToast()

  function start({ key, url, file, to }: UploadRequest): void {
    if (uploads.has(key)) return
    const xhr = new XMLHttpRequest()
    let cancelled = false
    const promise = new Promise<unknown>((resolve, reject) => {
      xhr.upload.onprogress = (e) => {
        upload.loaded = e.loaded
      }
      xhr.onload = () => {
        let body: { statusMessage?: string } | null = null
        try {
          body = JSON.parse(xhr.responseText)
        }
        catch {
          // Proxy error pages are not JSON.
        }
        if (xhr.status < 300) resolve(body)
        else reject({ data: { statusMessage: body?.statusMessage ?? `HTTP ${xhr.status}` } })
      }
      xhr.onerror = () => reject({ data: { statusMessage: 'Connection lost' } })
      xhr.onabort = () => reject(null)
    })
    const upload = reactive<Upload>({
      loaded: 0,
      total: file.size,
      promise,
      cancel: () => {
        cancelled = true
        xhr.abort()
      },
    })
    uploads.set(key, upload)

    xhr.open('POST', url)
    xhr.setRequestHeader('content-type', 'application/octet-stream')
    xhr.send(file)

    const id = `upload:${key}`
    toast.add({
      id,
      title: () => h('span', [
        `Uploading ${file.name}`,
        h(UProgress, { modelValue: upload.total ? upload.loaded / upload.total * 100 : 0, size: 'sm', class: 'absolute inset-x-0 bottom-0' }),
      ]),
      duration: 0,
      progress: false,
      onClick: to ? () => navigateTo(to) : undefined,
    })

    // A fresh toast instead of toast.update: the Toaster measures a toast's height only on mount.
    promise
      .catch((e) => {
        if (!cancelled) toast.add({ title: `Upload of ${file.name} failed`, description: errMsg(e, ''), color: 'error' })
      })
      .finally(() => {
        toast.remove(id)
        uploads.delete(key)
      })
  }

  return {
    find: (key: string) => uploads.get(key),
    start,
  }
}
