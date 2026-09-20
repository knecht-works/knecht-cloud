import { createVendorCache, createVendorFetch, type VendorRequest } from '../vendor-fetch'
import type { AdfNode } from './adf'
import { jiraCredentials } from './credentials'

interface JiraAuth {
  siteUrl: string
  email: string
  apiToken: string
}

const vendorFetch = createVendorFetch<JiraAuth>({
  name: 'Jira',
  credentials: jiraCredentials,
  baseUrl: auth => auth.siteUrl,
  headers: auth => ({ Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString('base64')}` }),
})

function jiraFetch<T>(path: string, { base = '/rest/api/3', ...opts }: VendorRequest<JiraAuth> & { base?: '/rest/api/3' | '/rest/agile/1.0' } = {}): Promise<T> {
  return vendorFetch<T>(`${base}${path}`, opts)
}

const cache = createVendorCache(Infinity)
export const forgetJiraCache = cache.forget

export async function jiraMyself(auth?: JiraAuth): Promise<{ displayName: string, accountId: string }> {
  const me = await jiraFetch<{ displayName?: string, accountId?: string }>('/myself', { auth })
  return { displayName: me.displayName ?? 'Unknown account', accountId: me.accountId ?? '' }
}

export function jiraIssueUrl(key: string): string {
  return `${jiraCredentials()?.siteUrl ?? ''}/browse/${key}`
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

// A status never changes its category, so one lookup per status id serves every later transition.
export async function getJiraStatusCategory(statusId: string): Promise<string | null> {
  try {
    return await cache.cached(`status:${statusId}`, async () => {
      const res = await jiraFetch<{ statusCategory?: { key?: string } }>(`/status/${encodeURIComponent(statusId)}`)
      if (!res.statusCategory?.key) throw new Error('status without a category')
      return res.statusCategory.key
    })
  }
  catch {
    return null
  }
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

export interface JiraComment {
  id: string
  body: AdfNode | null
  author: { accountId: string, displayName: string }
}

// Fetched instead of read from the webhook payload: the REST v3 body is ADF, always.
export async function getJiraComment(issueKey: string, commentId: string): Promise<JiraComment> {
  const res = await jiraFetch<{ id?: string, body?: AdfNode | null, author?: { accountId?: string, displayName?: string } }>(
    `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
  )
  return {
    id: res.id ?? commentId,
    body: res.body ?? null,
    author: { accountId: res.author?.accountId ?? '', displayName: res.author?.displayName ?? '' },
  }
}

interface JiraUser {
  accountId?: string
  displayName?: string
}

export interface JiraIssueFields {
  summary?: string
  description?: AdfNode | null
  status?: { name?: string, statusCategory?: { key?: string } }
  assignee?: JiraUser | null
  reporter?: JiraUser | null
  labels?: string[]
  issuetype?: { name?: string }
  project?: { key?: string }
  comment?: { comments?: { author?: JiraUser, created?: string, body?: AdfNode | null }[] }
}

export async function getJiraIssueFields(issueKey: string): Promise<JiraIssueFields> {
  const res = await jiraFetch<{ fields?: JiraIssueFields }>(`/issue/${encodeURIComponent(issueKey)}?fields=summary,description,status,assignee,reporter,labels,issuetype,comment`)
  return res.fields ?? {}
}

export async function addJiraComment(issueKey: string, body: AdfNode): Promise<{ url: string }> {
  const res = await jiraFetch<{ id?: string }>(`/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    body: { body },
  })
  return { url: `${jiraIssueUrl(issueKey)}${res.id ? `?focusedCommentId=${res.id}` : ''}` }
}

export async function updateJiraLabels(issueKey: string, add: string[], remove: string[]): Promise<void> {
  await jiraFetch(`/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    body: { update: { labels: [...add.map(label => ({ add: label })), ...remove.map(label => ({ remove: label }))] } },
  })
}

export interface JiraTransition {
  id: string
  to: string
}

export async function listJiraTransitions(issueKey: string): Promise<JiraTransition[]> {
  const res = await jiraFetch<{ transitions?: { id?: string, to?: { name?: string } }[] }>(`/issue/${encodeURIComponent(issueKey)}/transitions`)
  return (res.transitions ?? [])
    .filter(t => t.id && t.to?.name)
    .map(t => ({ id: t.id!, to: t.to!.name! }))
}

export async function transitionJiraIssue(issueKey: string, transitionId: string): Promise<void> {
  await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    body: { transition: { id: transitionId } },
  })
}
