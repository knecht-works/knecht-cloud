import { INTEGRATIONS } from '../../integrations'

export default defineEventHandler(() => INTEGRATIONS.map(i => ({
  id: i.id,
  name: i.name,
  configured: i.isConfigured(),
  link: i.link ? { label: i.link.label } : null,
})))
