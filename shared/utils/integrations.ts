// A new integration: add its id here, register it in server/integrations/index.ts
// and describe it in app/utils/integrations.ts. Everything else derives from these.
export const INTEGRATION_IDS = ['github', 'jira'] as const
export type IntegrationId = typeof INTEGRATION_IDS[number]

export const TRIGGER_SOURCES = ['schedule', ...INTEGRATION_IDS] as const
export type TriggerSource = typeof TRIGGER_SOURCES[number]

export const OBJECT_KINDS = ['issue', 'pull_request'] as const
export type ObjectKind = typeof OBJECT_KINDS[number]
