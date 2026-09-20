export interface WebhookConnection {
  configured: boolean
  accountName: string | null
  webhookUrl: string | null
  webhookSecret: string | null
  lastDelivery: { at: number, summary: string } | null
  lastRejected: { at: number, reason: 'signature' | 'empty-body' | 'no-project' } | null
}

export function useIntegrationConnection<T extends WebhookConnection>(path: string, name: string) {
  const toast = useToast()
  const connection = ref<T>() as Ref<T | undefined>
  // Nitro's typed $fetch cannot resolve a generic response type, hence the cast.
  const request = (method: 'GET' | 'POST' | 'DELETE', body?: Record<string, string>) => $fetch(path, { method, body }) as Promise<T>
  const refresh = async () => {
    connection.value = await request('GET')
  }

  // These tools show no delivery log, so the settings page is where the admin sees the webhook arrive.
  let poll: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    void refresh()
    poll = setInterval(() => {
      if (connection.value?.configured) void refresh().catch(() => {})
    }, 5000)
  })
  onUnmounted(() => clearInterval(poll))

  const error = ref('')
  const connecting = ref(false)
  const disconnecting = ref(false)

  async function connect(body: Record<string, string>): Promise<boolean> {
    error.value = ''
    connecting.value = true
    try {
      const next = await request('POST', body)
      connection.value = next
      toast.add({ title: `Connected as ${next.accountName}`, color: 'success' })
      return true
    }
    catch (e) {
      error.value = errMsg(e, `Could not connect to ${name}.`)
      return false
    }
    finally {
      connecting.value = false
    }
  }

  async function disconnect() {
    error.value = ''
    disconnecting.value = true
    try {
      connection.value = await request('DELETE')
      toast.add({ title: `${name} disconnected`, color: 'success' })
    }
    catch (e) {
      error.value = errMsg(e, 'Could not disconnect.')
    }
    finally {
      disconnecting.value = false
    }
  }

  return { connection, error, connecting, disconnecting, connect, disconnect }
}
