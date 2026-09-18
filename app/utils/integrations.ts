import type { IntegrationId, ObjectKind } from '#shared/utils/integrations'

export interface SessionObjectMeta {
  icon: string
  label: string
  color: string
  // Rendered before the key: "#12" for GitHub, "PROJ-12" for Jira.
  prefix: string
}

export interface IntegrationUi {
  label: string
  icon: string
  color: string
  mentionHint: { code?: string, text: string }
  objects: Partial<Record<ObjectKind, SessionObjectMeta>>
}

export const INTEGRATION_UI: Record<IntegrationId, IntegrationUi> = {
  github: {
    label: 'GitHub',
    icon: 'i-simple-icons-github',
    color: 'var(--text-toned)',
    mentionHint: { code: '@knecht-works <instruction>', text: 'on an issue or pull request.' },
    objects: {
      issue: { icon: 'i-simple-icons-github', label: 'Issue', color: 'var(--text-highlighted)', prefix: '#' },
      pull_request: { icon: 'i-simple-icons-github', label: 'PR', color: 'var(--text-highlighted)', prefix: '#' },
    },
  },
  jira: {
    label: 'Jira',
    icon: 'i-simple-icons-jira',
    color: 'var(--brand-jira)',
    mentionHint: { text: 'mention the Knecht account on a ticket of the linked project.' },
    objects: {
      issue: { icon: 'i-simple-icons-jira', label: 'Ticket', color: 'var(--brand-jira)', prefix: '' },
    },
  },
}

export function integrationUi(id: IntegrationId): IntegrationUi {
  return INTEGRATION_UI[id]
}
