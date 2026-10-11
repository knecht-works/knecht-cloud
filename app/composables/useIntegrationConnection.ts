import type { ConnectionStatus } from '#shared/utils/connection-form'
import type { IntegrationId } from '#shared/utils/integrations'
import { liveTopics } from '#shared/utils/live-topics'

export function useIntegrationConnection(id: IntegrationId, name: string) {
  const toast = useToast()
  const connection = ref<ConnectionStatus>()
  const path = `/api/integrations/${id}`
  const request = (method: 'GET' | 'POST' | 'DELETE', body?: Record<string, string>) => $fetch<ConnectionStatus>(`${path}/connection`, { method, body })
  const refresh = async () => {
    connection.value = await request('GET')
  }

  // These tools show no delivery log, so the settings page is where the admin sees the webhook arrive.
  onMounted(() => void refresh())
  onLiveTopics(() => [liveTopics.integrations], () => refresh().catch(() => {}))

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

  async function saveSecret(webhookSecret: string) {
    connection.value = await $fetch<ConnectionStatus>(`${path}/webhook-secret`, { method: 'POST', body: { webhookSecret } })
  }

  return { connection, error, connecting, disconnecting, connect, disconnect, saveSecret }
}
