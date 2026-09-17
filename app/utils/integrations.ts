import type { Component } from 'vue'
import type { IntegrationId, ObjectKind } from '#shared/utils/integrations'
import KTriggerFormGithub from '~/components/KTriggerFormGithub.vue'
import KTriggerFormJira from '~/components/KTriggerFormJira.vue'
import KTriggerFormPlane from '~/components/KTriggerFormPlane.vue'

export interface SessionObjectMeta {
  icon: string
  closedIcon: string
  label: string
  color: string
  // Rendered before the key: "#12" for GitHub, "PROJ-12" for Jira.
  prefix: string
}

export interface IntegrationUi {
  label: string
  icon: string
  color: string
  // The trigger source picker's one-liner.
  hint: string
  settingsPath?: string
  mentionHint: { code?: string, text: string }
  triggerForm: Component
  objects: Partial<Record<ObjectKind, SessionObjectMeta>>
}

export const INTEGRATION_UI: Record<IntegrationId, IntegrationUi> = {
  github: {
    label: 'GitHub',
    icon: 'i-simple-icons-github',
    color: 'var(--text-toned)',
    hint: 'Run on GitHub events',
    mentionHint: { code: '@knecht-works <instruction>', text: 'on an issue or pull request.' },
    triggerForm: KTriggerFormGithub,
    objects: {
      issue: { icon: 'i-lucide-circle-dot', closedIcon: 'i-lucide-circle-check', label: 'Issue', color: 'var(--text-primary)', prefix: '#' },
      pull_request: { icon: 'i-lucide-git-pull-request', closedIcon: 'i-lucide-git-pull-request-closed', label: 'PR', color: 'var(--accent-violet)', prefix: '#' },
    },
  },
  jira: {
    label: 'Jira',
    icon: 'i-simple-icons-jira',
    color: '#579dff',
    hint: 'Run on Jira tickets',
    settingsPath: '/settings/jira',
    mentionHint: { text: 'mention the Knecht account on a ticket of the linked project.' },
    triggerForm: KTriggerFormJira,
    objects: {
      issue: { icon: 'i-simple-icons-jira', closedIcon: 'i-lucide-circle-check', label: 'Ticket', color: '#579dff', prefix: '' },
    },
  },
  plane: {
    label: 'Plane',
    icon: 'i-simple-icons-plane',
    color: '#3f76ff',
    hint: 'Run on Plane work items',
    settingsPath: '/settings/plane',
    mentionHint: { text: 'mention the Knecht account on a work item of the linked project.' },
    triggerForm: KTriggerFormPlane,
    objects: {
      issue: { icon: 'i-simple-icons-plane', closedIcon: 'i-lucide-circle-check', label: 'Work item', color: '#3f76ff', prefix: '' },
    },
  },
}

export function integrationUi(id: IntegrationId): IntegrationUi {
  return INTEGRATION_UI[id]
}
