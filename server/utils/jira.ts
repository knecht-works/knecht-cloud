import { ofetch } from 'ofetch'
import { adfToMarkdown, type AdfNode } from './adf'
import { jiraCredentials } from './jira-credentials'

interface JiraAuth {
  siteUrl: string
  email: string
  apiToken: string
}

// ofetch instead of $fetch: the URL is an external site, not a Nitro route.
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

export async function jiraMyself(auth?: JiraAuth): Promise<{ displayName: string }> {
  const me = await jiraFetch<{ displayName?: string }>('/myself', { auth })
  return { displayName: me.displayName ?? 'Unknown account' }
}

export interface JiraProject {
  key: string
  name: string
}

export async function listJiraProjects(): Promise<JiraProject[]> {
  const res = await jiraFetch<{ values?: { key?: string, name?: string }[] }>('/project/search?maxResults=100&orderBy=name')
  return (res.values ?? [])
    .filter(p => p.key)
    .map(p => ({ key: p.key!, name: p.name ?? p.key! }))
}

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

  const names = new Set<string>()
  for (const id of boardIds) {
    const name = byId.get(id)
    if (name) names.add(name)
  }
  return [...names]
}

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
