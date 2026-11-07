// A new integration: add its id to REPO_PROVIDERS or TRACKER_IDS, register it in
// server/integrations/index.ts and describe it in app/utils/integrations.ts. Everything else derives from these.
export const REPO_PROVIDERS = ['github'] as const
export type RepoProvider = typeof REPO_PROVIDERS[number]

export const TRACKER_IDS = ['jira', 'plane', 'linear'] as const
export type TrackerId = typeof TRACKER_IDS[number]

export const INTEGRATION_IDS = [...REPO_PROVIDERS, ...TRACKER_IDS] as const
export type IntegrationId = typeof INTEGRATION_IDS[number]

export const TRIGGER_SOURCES = ['git', 'tracker', 'schedule'] as const
export type TriggerSource = typeof TRIGGER_SOURCES[number]

export function isTrackerId(id: string): id is TrackerId {
  return (TRACKER_IDS as readonly string[]).includes(id)
}

export function integrationRole(id: IntegrationId): 'git' | 'tracker' {
  return isTrackerId(id) ? 'tracker' : 'git'
}

export const OBJECT_KINDS = ['issue', 'pull_request'] as const
export type ObjectKind = typeof OBJECT_KINDS[number]
