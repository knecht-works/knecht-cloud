import type { ConnectionFormDef } from '../../../shared/utils/connection-form'
import { createConnectionStore } from '../connections'

export const JIRA_CONNECTION_FORM: ConnectionFormDef = {
  intro: 'Tickets start workflows and get Knecht\'s replies. Connect with an API token, ideally of a dedicated "Knecht" account, then link each project to its Jira project in the project settings.',
  docs: { label: 'Create an API token', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
  fields: [
    { key: 'siteUrl', label: 'Site URL', type: 'url', placeholder: 'https://acme.atlassian.net', mono: true, required: 'Enter your Jira site URL.', invalid: 'Must be an https:// URL, e.g. https://acme.atlassian.net.' },
    { key: 'email', label: 'Email', type: 'email', placeholder: 'knecht@acme.com', required: 'Enter the account\'s email.', invalid: 'That doesn\'t look like an email address.' },
    { key: 'apiToken', label: 'API token', type: 'secret', placeholder: 'ATATT…', required: 'Paste an API token.' },
  ],
  rejected: 'Jira rejected the connection. Check the site URL, email and API token.',
  webhook: {
    secret: 'minted',
    setupUrl: '{siteUrl}/plugins/servlet/webhooks',
    instructions: 'Create a webhook in Jira with these two values, tick "Issue created, updated, deleted" and "Comment created", and leave "Exclude body" unchecked. Then edit any ticket in a linked project.',
    events: {
      'jira:issue_created': 'issue created',
      'jira:issue_updated': 'issue updated',
      'jira:issue_deleted': 'issue deleted',
      'comment_created': 'comment on',
    },
    rejectCopy: {
      'signature': 'with a wrong secret. Paste the secret into the webhook again.',
      'empty-body': 'without a body. Uncheck "Exclude body" in the webhook.',
      'no-project': 'for a Jira project no project is linked to yet.',
    },
  },
}

export const jiraConnection = createConnectionStore<'siteUrl' | 'email' | 'apiToken'>('jira', JIRA_CONNECTION_FORM)
export const jiraCredentials = jiraConnection.credentials
