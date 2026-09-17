import { ofetch } from 'ofetch'
import { formatObjectContext } from '../../utils/object-context'
import { planeCredentials } from './credentials'
import { htmlToMarkdown } from './html'

interface PlaneAuth {
  siteUrl: string
  workspaceSlug: string
  apiKey: string
}

// Plane Cloud serves the API from its own host; a self-hosted instance serves it next to the app.
export function planeApiOrigin(siteUrl: string): string {
  return /^https?:\/\/app\.plane\.so$/i.test(siteUrl) ? 'https://api.plane.so' : siteUrl
}

// ofetch instead of $fetch: the URL is an external site, not a Nitro route.
async function planeFetch<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PATCH', body?: Record<string, unknown>, auth?: PlaneAuth } = {}): Promise<T> {
  const creds = opts.auth ?? planeCredentials()
  if (!creds) throw new Error('Plane is not connected')
  return await ofetch<T>(`${planeApiOrigin(creds.siteUrl)}/api/v1${path}`, {
    method: opts.method ?? 'GET',
    body: opts.body,
    headers: { 'X-API-Key': creds.apiKey, 'Accept': 'application/json' },
  })
}

function workspacePath(path: string, auth?: PlaneAuth): string {
  const slug = (auth ?? planeCredentials())?.workspaceSlug ?? ''
  return `/workspaces/${encodeURIComponent(slug)}${path}`
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const res = await planeFetch<{ results?: T[], next_cursor?: string, next_page_results?: boolean }>(`${path}?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    items.push(...(res.results ?? []))
    cursor = res.next_page_results ? res.next_cursor : undefined
  } while (cursor)
  return items
}

// Plane allows 60 requests a minute; one delivery needs several lookups that rarely change.
const TTL_MS = 60_000
const memo = new Map<string, { at: number, value: Promise<unknown> }>()
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>
  const value = load().catch((e) => {
    memo.delete(key)
    throw e
  })
  memo.set(key, { at: Date.now(), value })
  return value
}

export function forgetPlaneCache(): void {
  memo.clear()
}

export async function planeMyself(auth?: PlaneAuth): Promise<{ displayName: string, accountId: string }> {
  const me = await planeFetch<{ id?: string, display_name?: string, email?: string }>('/users/me/', { auth })
  await planeFetch(`${workspacePath('/projects/', auth)}?per_page=1`, { auth })
  return { displayName: me.display_name || me.email || 'Unknown account', accountId: me.id ?? '' }
}

export interface PlaneProject {
  id: string
  identifier: string
  name: string
}

export function listPlaneProjects(): Promise<PlaneProject[]> {
  return cached('projects', async () => {
    const projects = await listAll<{ id?: string, identifier?: string, name?: string }>(workspacePath('/projects/'))
    return projects
      .filter(p => p.id && p.identifier)
      .map(p => ({ id: p.id!, identifier: p.identifier!, name: p.name ?? p.identifier! }))
  })
}

export async function planeProjectByIdentifier(identifier: string): Promise<PlaneProject> {
  const project = (await listPlaneProjects()).find(p => p.identifier === identifier)
  if (!project) throw new Error(`Plane project ${identifier} not found in the workspace`)
  return project
}

export async function planeProjectById(id: string): Promise<PlaneProject | undefined> {
  return (await listPlaneProjects()).find(p => p.id === id)
}

export function planeWorkItemUrl(key: string): string {
  const creds = planeCredentials()
  return creds ? `${creds.siteUrl}/${creds.workspaceSlug}/browse/${key}/` : ''
}

export interface PlaneState {
  id: string
  name: string
  group: string
}

export function listPlaneStates(projectId: string): Promise<PlaneState[]> {
  return cached(`states:${projectId}`, async () => {
    const states = await listAll<{ id?: string, name?: string, group?: string }>(workspacePath(`/projects/${projectId}/states/`))
    return states.filter(s => s.id && s.name).map(s => ({ id: s.id!, name: s.name!, group: s.group ?? '' }))
  })
}

export interface PlaneLabel {
  id: string
  name: string
}

export function listPlaneLabels(projectId: string): Promise<PlaneLabel[]> {
  return cached(`labels:${projectId}`, async () => {
    const labels = await listAll<{ id?: string, name?: string }>(workspacePath(`/projects/${projectId}/labels/`))
    return labels.filter(l => l.id && l.name).map(l => ({ id: l.id!, name: l.name! }))
  })
}

export interface PlaneMember {
  id: string
  displayName: string
}

export function listPlaneMembers(projectId: string): Promise<PlaneMember[]> {
  return cached(`members:${projectId}`, async () => {
    const members = await planeFetch<{ id?: string, display_name?: string, email?: string }[]>(workspacePath(`/projects/${projectId}/project-members/`))
    return members.filter(m => m.id).map(m => ({ id: m.id!, displayName: m.display_name || m.email || '' }))
  })
}

export interface PlaneWorkItem {
  id: string
  sequenceId: number
  name: string
  descriptionHtml: string | null
  stateId: string | null
  labelIds: string[]
  assigneeIds: string[]
  createdById: string | null
}

interface RawWorkItem {
  id?: string
  sequence_id?: number
  name?: string
  description_html?: string | null
  state?: string | null
  labels?: string[]
  assignees?: string[]
  created_by?: string | null
}

function workItemOf(raw: RawWorkItem): PlaneWorkItem {
  return {
    id: raw.id ?? '',
    sequenceId: raw.sequence_id ?? 0,
    name: raw.name ?? '',
    descriptionHtml: raw.description_html ?? null,
    stateId: raw.state ?? null,
    labelIds: raw.labels ?? [],
    assigneeIds: raw.assignees ?? [],
    createdById: raw.created_by ?? null,
  }
}

export async function getPlaneWorkItem(projectId: string, workItemId: string): Promise<PlaneWorkItem> {
  return workItemOf(await planeFetch<RawWorkItem>(workspacePath(`/projects/${projectId}/work-items/${workItemId}/`)))
}

// `key` is what the dashboard shows: PROJ-12.
export async function getPlaneWorkItemByKey(key: string): Promise<PlaneWorkItem> {
  return workItemOf(await planeFetch<RawWorkItem>(workspacePath(`/work-items/${encodeURIComponent(key)}/`)))
}

export interface PlaneComment {
  id: string
  html: string
  actor: { id: string, displayName: string }
  createdAt: string
}

interface RawComment {
  id?: string
  comment_html?: string | null
  actor?: { id?: string, display_name?: string } | null
  created_at?: string
}

function commentOf(raw: RawComment): PlaneComment {
  return {
    id: raw.id ?? '',
    html: raw.comment_html ?? '',
    actor: { id: raw.actor?.id ?? '', displayName: raw.actor?.display_name ?? '' },
    createdAt: raw.created_at ?? '',
  }
}

// Fetched instead of read from the webhook payload: the delivery carries only the stripped text, mentions are in the HTML.
export async function getPlaneComment(projectId: string, workItemId: string, commentId: string): Promise<PlaneComment> {
  return commentOf(await planeFetch<RawComment>(workspacePath(`/projects/${projectId}/work-items/${workItemId}/comments/${commentId}/`)))
}

export async function listPlaneComments(projectId: string, workItemId: string): Promise<PlaneComment[]> {
  return (await listAll<RawComment>(workspacePath(`/projects/${projectId}/work-items/${workItemId}/comments/`))).map(commentOf)
}

export async function addPlaneComment(projectId: string, workItemId: string, html: string): Promise<void> {
  await planeFetch(workspacePath(`/projects/${projectId}/work-items/${workItemId}/comments/`), {
    method: 'POST',
    body: { comment_html: html },
  })
}

export async function updatePlaneWorkItem(projectId: string, workItemId: string, patch: { labels?: string[], state?: string }): Promise<void> {
  await planeFetch(workspacePath(`/projects/${projectId}/work-items/${workItemId}/`), { method: 'PATCH', body: patch })
}

export async function getPlaneWorkItemContext(projectId: string, key: string): Promise<string> {
  const item = await getPlaneWorkItemByKey(key)
  const [states, labels, members, comments] = await Promise.all([
    listPlaneStates(projectId),
    listPlaneLabels(projectId),
    listPlaneMembers(projectId),
    listPlaneComments(projectId, item.id),
  ])
  const name = (id: string | null) => members.find(m => m.id === id)?.displayName ?? ''
  return formatObjectContext({
    heading: `${key}: ${item.name}`,
    url: planeWorkItemUrl(key),
    facts: [
      ['State', states.find(s => s.id === item.stateId)?.name ?? ''],
      ['Author', name(item.createdById)],
      ['Assignees', item.assigneeIds.map(name).filter(Boolean).join(', ')],
      ['Labels', item.labelIds.map(id => labels.find(l => l.id === id)?.name ?? '').filter(Boolean).join(', ')],
    ],
    body: htmlToMarkdown(item.descriptionHtml),
    comments: comments.map(c => ({
      author: c.actor.displayName || 'unknown',
      at: new Date(c.createdAt || 0),
      body: htmlToMarkdown(c.html),
    })),
  })
}
