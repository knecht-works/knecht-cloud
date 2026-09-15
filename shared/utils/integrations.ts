export const INTEGRATION_IDS = ['github', 'jira'] as const
export type IntegrationId = typeof INTEGRATION_IDS[number]

export const OBJECT_KINDS = ['issue', 'pull_request'] as const
export type ObjectKind = typeof OBJECT_KINDS[number]
