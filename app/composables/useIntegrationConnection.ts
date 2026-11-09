import type { ConnectionStatus } from '#shared/utils/connection-form'
import type { IntegrationId } from '#shared/utils/integrations'
import { liveTopics } from '#shared/utils/live-topics'

export async function useIntegrationConnection(id: IntegrationId, name: string) {
  const toast = useToast()
  const path = `/api/integrations/${id}`
  const request = (method: 'POST' | 'DELETE', body?: Record<string, string>) => $fetch<ConnectionStatus>(`${path}/connection`, { method, body })
  const fetched = useFetch<ConnectionStatus>(`${path}/connection`, { key: `integration-connection:${id}` })
  const { data: connection, refresh } = fetched

  // These tools show no delivery log, so the settings page is where the admin sees the webhook arrive.
  onLiveTopics(() => [liveTopics.integrations], () => refresh())

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

  async function disconnect(): Promise<boolean> {
    error.value = ''
    disconnecting.value = true
    try {
      connection.value = await request('DELETE')
      toast.add({ title: `${name} disconnected`, color: 'success' })
      return true
    }
    catch (e) {
      error.value = errMsg(e, 'Could not disconnect.')
      return false
    }
    finally {
      disconnecting.value = false
    }
  }

  async function saveSecret(webhookSecret: string) {
    connection.value = await $fetch<ConnectionStatus>(`${path}/webhook-secret`, { method: 'POST', body: { webhookSecret } })
  }

  // Awaited last: hooks registered after an await lose the component instance.
  await fetched
  return { connection, error, connecting, disconnecting, connect, disconnect, saveSecret }
}
