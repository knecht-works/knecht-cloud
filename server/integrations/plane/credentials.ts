import type { ConnectionFormDef } from '../../../shared/utils/connection-form'
import { createConnectionStore } from '../connections'

export const PLANE_CONNECTION_FORM: ConnectionFormDef = {
  intro: 'Work items start workflows and get Knecht\'s replies. Connect with a personal access token (Profile settings → Personal access tokens), ideally of a dedicated "Knecht" account, then link each project to its Plane project in the project settings.',
  fields: [
    { key: 'siteUrl', label: 'Plane URL', type: 'url', placeholder: 'https://app.plane.so', default: 'https://app.plane.so', mono: true, required: 'Enter your Plane URL.', invalid: 'Must be an https:// URL, e.g. https://app.plane.so.' },
    { key: 'workspaceSlug', label: 'Workspace slug', type: 'text', placeholder: 'acme', mono: true, required: 'Enter the workspace slug.', pattern: '^[a-z0-9-]+$', invalid: 'The slug is the first path segment of your Plane URL, e.g. acme.' },
    { key: 'apiKey', label: 'API key', type: 'secret', placeholder: 'plane_api_…', required: 'Paste an API key.' },
  ],
  rejected: 'Plane rejected the connection. Check the site URL, workspace slug and API key.',
  webhook: {
    secret: 'pasted',
    setupUrl: '{siteUrl}/{workspaceSlug}/settings/webhooks',
    instructions: 'Add a webhook in Plane with this URL, tick the "Work item" events created, updated, archived and deleted plus "Work item comment" created, then paste the secret key Plane generates below. Then edit any work item in a linked project.',
    events: {
      'workitem.created': 'work item created',
      'workitem.updated': 'work item updated',
      'workitem.archived': 'work item archived',
      'workitem.deleted': 'work item deleted',
      'workitem.comment.created': 'comment on',
    },
    rejectCopy: {
      'signature': 'with a wrong secret. Replace the secret below with the secret key of the webhook.',
      'empty-body': 'without a body.',
      'no-project': 'for a Plane project no project is linked to yet, or for an event Knecht does not use.',
    },
  },
}

export const planeConnection = createConnectionStore<'siteUrl' | 'workspaceSlug' | 'apiKey'>('plane', PLANE_CONNECTION_FORM)
export const planeCredentials = planeConnection.credentials
