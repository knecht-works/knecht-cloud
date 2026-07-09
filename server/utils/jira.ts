import { ofetch } from 'ofetch'
import { adfToMarkdown, type AdfNode } from './adf'
import { jiraCredentials } from './jira-credentials'

// Thin Jira Cloud REST v3 client over the stored connection (jira-credentials).
// Auth is Basic (email + API token), which carries the account's own
// permissions: whatever projects the account can see, Knecht can poll and
// comment on. All calls go through jiraFetch; there is no SDK dependency.

interface JiraAuth {
  siteUrl: string
  email: string
  apiToken: string
}

// `auth` override: connection.post.ts validates credentials BEFORE storing
// them. `base` picks the API family (boards live under the agile API). ofetch
// instead of the app's $fetch: the URL is an external site, not one of Nitro's
// typed routes.
async function jiraFetch<T>(path: string, opts: { method?: 'GET' | 'POST', body?: Record<string, unknown>, auth?: JiraAuth, base?: '/rest/api/3' | '/rest/agile/1.0' } = {}): Promise<T> {
  const creds = opts.auth ?? jiraCredentials()
  if (!creds) throw new Error('Jira is not connected')
  return await ofetch<T>(`${creds.siteUrl}${opts.base ?? '/rest/api/3'}${path}`, {
    method: opts.method ?? 'GET',
    body: opts.body,
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
  })
}

// Who the token authenticates as. Used to validate a connection before saving
// it and to display "Connected as …".
export async function jiraMyself(auth?: JiraAuth): Promise<{ displayName: string }> {
  const me = await jiraFetch<{ displayName?: string }>('/myself', { auth })
  return { displayName: me.displayName ?? 'Unknown account' }
}

export interface JiraProject {
  key: string
  name: string
}

// The projects the connected account can browse (the trigger form's dropdown).
// One page of 100 covers any realistic site; larger sites can type the key.
export async function listJiraProjects(): Promise<JiraProject[]> {
  const res = await jiraFetch<{ values?: { key?: string, name?: string }[] }>('/project/search?maxResults=100&orderBy=name')
  return (res.values ?? [])
    .filter(p => p.key)
    .map(p => ({ key: p.key!, name: p.name ?? p.key! }))
}

// The status names for the trigger form's dropdown. The project's status
// catalog (/project/{key}/statuses) spans EVERY issue type's workflow, subtask
// and epic statuses included, which offers choices a card on the user's board
// can never reach. So when the project has boards, the catalog is narrowed to
// the statuses their columns map: exactly what the user sees as columns.
// Projects without a board keep the full catalog.
export async function listJiraStatuses(projectKey: string): Promise<string[]> {
  const res = await jiraFetch<{ statuses?: { id?: string, name?: string }[] }[]>(`/project/${encodeURIComponent(projectKey)}/statuses`)
  const byId = new Map<string, string>()
  for (const type of res) {
    for (const s of type.statuses ?? []) {
      if (s.id && s.name) byId.set(s.id, s.name)
    }
  }

  const boardIds = await boardStatusIds(projectKey)
  if (!boardIds) return [...new Set(byId.values())]

  // Board order (left to right), so the dropdown reads like the board.
  const names = new Set<string>()
  for (const id of boardIds) {
    const name = byId.get(id)
    if (name) names.add(name)
  }
  return [...names]
}

// The status ids mapped to a column on any of the project's boards, in column
// order, or null when the project has none (or the agile API is unavailable),
// which means "don't narrow".
async function boardStatusIds(projectKey: string): Promise<string[] | null> {
  try {
    const boards = await jiraFetch<{ values?: { id?: number }[] }>(
      `/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=10`,
      { base: '/rest/agile/1.0' },
    )
    const ids: string[] = []
    for (const board of boards.values ?? []) {
      if (board.id === undefined) continue
      const conf = await jiraFetch<{ columnConfig?: { columns?: { statuses?: { id?: string }[] }[] } }>(
        `/board/${board.id}/configuration`,
        { base: '/rest/agile/1.0' },
      )
      for (const column of conf.columnConfig?.columns ?? []) {
        for (const s of column.statuses ?? []) {
          if (s.id && !ids.includes(s.id)) ids.push(s.id)
        }
      }
    }
    return ids.length ? ids : null
  }
  catch {
    return null
  }
}

// The keys of the issues currently matching `jql` (the poller's working set).
// Capped at one page: a trigger's matching set is "tickets currently carrying
// the label / sitting in the status", which is small by nature.
export async function searchJiraIssueKeys(jql: string): Promise<string[]> {
  const res = await jiraFetch<{ issues?: { key?: string }[] }>('/search/jql', {
    method: 'POST',
    body: { jql, maxResults: 100, fields: ['summary'] },
  })
  return (res.issues ?? []).map(i => i.key).filter((k): k is string => !!k)
}

export interface JiraIssue {
  key: string
  title: string
  body: string
  url: string
}

// One issue's run inputs: title, description rendered to Markdown, browse URL.
export async function getJiraIssue(key: string): Promise<JiraIssue> {
  const creds = jiraCredentials()
  const res = await jiraFetch<{ fields?: { summary?: string, description?: AdfNode | null } }>(
    `/issue/${encodeURIComponent(key)}?fields=summary,description`,
  )
  return {
    key,
    title: res.fields?.summary ?? '',
    body: adfToMarkdown(res.fields?.description),
    url: `${creds?.siteUrl}/browse/${key}`,
  }
}

// Post a comment on an issue (the PR-link handed back after a run). Comments
// are written as ADF; `text` becomes one paragraph, `linkUrl` a link on its
// own line.
export async function addJiraComment(key: string, text: string, linkUrl?: string): Promise<void> {
  const content: AdfNode[] = [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  if (linkUrl) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: linkUrl, marks: [{ type: 'link', attrs: { href: linkUrl } }] }],
    })
  }
  await jiraFetch(`/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: { body: { type: 'doc', version: 1, content } },
  })
}
