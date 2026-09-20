import type { ConnectionFormDef } from '../../../shared/utils/connection-form'
import { createConnectionStore } from '../connections'

export const LINEAR_CONNECTION_FORM: ConnectionFormDef = {
  intro: 'Issues start workflows and get Knecht\'s replies. Connect with a personal API key (Settings → Security & access → Personal API keys), ideally of a dedicated "Knecht" account, then link each project to its Linear team in the project settings.',
  fields: [
    { key: 'apiKey', label: 'API key', type: 'secret', placeholder: 'lin_api_…', required: 'Paste an API key.', pattern: '^\\S+$', invalid: 'An API key has no spaces. Copy it again from Linear.' },
  ],
  rejected: 'Linear rejected the connection. Check the API key.',
  webhook: {
    secret: 'pasted',
    setupUrl: 'https://linear.app/settings/api',
    instructions: 'Add a webhook in Linear (Settings → API → Webhooks, as a workspace admin) with this URL, tick the data change events "Issues" and "Comments", then paste the signing secret Linear shows below. Then edit any issue of a linked team.',
    events: {
      'Issue.create': 'issue created',
      'Issue.update': 'issue updated',
      'Issue.remove': 'issue removed',
      'Comment.create': 'comment on',
    },
    rejectCopy: {
      'signature': 'with a wrong secret. Replace the secret below with the signing secret of the webhook.',
      'empty-body': 'without a body.',
      'no-project': 'for a Linear team no project is linked to yet, or for an event Knecht does not use.',
    },
  },
}

export const linearConnection = createConnectionStore<'apiKey'>('linear', LINEAR_CONNECTION_FORM)
export const linearCredentials = linearConnection.credentials
