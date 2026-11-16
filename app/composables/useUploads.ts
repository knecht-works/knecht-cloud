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

const CHUNK_BYTES = 16 * 1024 * 1024
const RETRIES = 3

interface UploadError {
  status?: number
  data: { statusMessage: string }
}

const retryable = (e: UploadError | null) => !!e && (!e.status || [408, 502, 503, 504].includes(e.status))

export function useUploads() {
  const toast = useToast()

  function start(request: UploadRequest, from = 0): void {
    const { key, url, file, to } = request
    if (uploads.has(key)) return
    let xhr: XMLHttpRequest | undefined
    let cancelled = false
    let offset = from

    function send(end: number) {
      return new Promise<unknown>((resolve, reject) => {
        xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (e) => {
          upload.loaded = offset + e.loaded
        }
        xhr.onload = () => {
          let body: { statusMessage?: string } | null = null
          try {
            body = JSON.parse(xhr!.responseText)
          }
          catch {
            // Proxy error pages are not JSON.
          }
          if (xhr!.status < 300) resolve(body)
          else reject({ status: xhr!.status, data: { statusMessage: body?.statusMessage ?? `HTTP ${xhr!.status}` } })
        }
        xhr.onerror = () => reject({ data: { statusMessage: 'Connection lost' } })
        xhr.onabort = () => reject(null)
        xhr.open('POST', url)
        xhr.setRequestHeader('content-type', 'application/octet-stream')
        xhr.setRequestHeader('x-upload-offset', String(offset))
        xhr.setRequestHeader('x-upload-total', String(file.size))
        xhr.send(file.slice(offset, end))
      })
    }

    async function run() {
      let result: unknown
      do {
        const end = Math.min(offset + CHUNK_BYTES, file.size)
        for (let attempt = 0; ; attempt++) {
          if (cancelled) throw null
          try {
            result = await send(end)
            break
          }
          catch (e) {
            if (cancelled || attempt >= RETRIES || !retryable(e as UploadError | null)) throw e
            await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000))
          }
        }
        offset = end
        upload.loaded = offset
      } while (offset < file.size)
      return result
    }

    const promise = run()
    const upload = reactive<Upload>({
      loaded: from,
      total: file.size,
      promise,
      cancel: () => {
        cancelled = true
        xhr?.abort()
      },
    })
    uploads.set(key, upload)

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
      .catch((e: UploadError | null) => {
        if (cancelled) return
        toast.add({
          title: `Upload of ${file.name} failed`,
          description: errMsg(e, ''),
          color: 'error',
          duration: 0,
          actions: [{ label: 'Retry', onClick: () => start(request, e?.status === 409 ? 0 : offset) }],
        })
      })
      .finally(() => {
        toast.remove(id)
        uploads.delete(key)
      })
  }

  return {
    find: (key: string) => uploads.get(key),
    start: (request: UploadRequest) => start(request),
  }
}
