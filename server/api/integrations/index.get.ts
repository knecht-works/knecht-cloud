import { INTEGRATIONS } from '../../integrations'

export default defineEventHandler(() => INTEGRATIONS.map(i => ({
  id: i.id,
  name: i.name,
  configured: i.isConfigured(),
  accountName: i.connection?.store.status().accountName ?? null,
  link: i.link ? { label: i.link.label } : null,
  triggerForm: i.trigger.form,
  connectionForm: i.connection?.form ?? null,
})))
