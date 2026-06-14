// GET /api/triggers → configured triggers (webhooks, schedules, manual).
//
// Triggers aren't implemented yet — there's no table, no webhook receiver and no
// scheduler. This endpoint returns an empty list so the Triggers screen is fully
// data-driven and shows its honest empty state. The shape below is the contract
// the UI renders against, so the screen is ready the moment the feature lands.
export interface TriggerSummary {
  id: number
  source: 'github' | 'jira' | 'schedule' | 'manual'
  event: string
  kind: 'Webhook' | 'Cron' | 'Manual'
  workflow: string
  projects: string[]
  endpoint: string | null
  active: boolean
  lastFiredAt: number | null
  firedCount: number
}

export default defineEventHandler((): TriggerSummary[] => {
  return []
})
