import { createVendorCache, createVendorFetch } from '../vendor-fetch'
import { planeCredentials } from './credentials'

interface PlaneAuth {
  siteUrl: string
  workspaceSlug: string
  apiKey: string
}

// Plane Cloud serves the API from its own host; a self-hosted instance serves it next to the app.
export function planeApiOrigin(siteUrl: string): string {
  return /^https?:\/\/app\.plane\.so$/i.test(siteUrl) ? 'https://api.plane.so' : siteUrl
}

const planeFetch = createVendorFetch<PlaneAuth>({
  name: 'Plane',
  credentials: planeCredentials,
  baseUrl: auth => `${planeApiOrigin(auth.siteUrl)}/api/v1`,
  headers: auth => ({ 'X-API-Key': auth.apiKey }),
})

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
const { cached, forget: forgetPlaneCache } = createVendorCache(60_000)
export { forgetPlaneCache }

export interface PlaneUser {
  id?: string
  first_name?: string
  last_name?: string
  display_name?: string
  email?: string
}

// Plane defaults display_name to the local part of the email; the name a person typed is first and last name.
export function planeUserName(user: PlaneUser | null | undefined): string {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.display_name || user?.email || ''
}

export async function planeMyself(auth?: PlaneAuth): Promise<{ displayName: string, accountId: string }> {
  const me = await planeFetch<PlaneUser>('/users/me/', { auth })
  await planeFetch(`${workspacePath('/projects/', auth)}?per_page=1`, { auth })
  return { displayName: planeUserName(me) || 'Unknown account', accountId: me.id ?? '' }
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
    const members = await planeFetch<PlaneUser[]>(workspacePath(`/projects/${projectId}/project-members/`))
    return members.filter(m => m.id).map(m => ({ id: m.id!, displayName: planeUserName(m) }))
  })
}

// The REST shape, as Plane sends it. The webhook names the same fields state_id, label_ids and assignee_ids.
export interface PlaneWorkItem {
  id: string
  sequence_id: number
  name: string
  description_html?: string | null
  state?: string | null
  labels?: string[]
  assignees?: string[]
  created_by?: string | null
}

export async function getPlaneWorkItem(projectId: string, workItemId: string): Promise<PlaneWorkItem> {
  return await planeFetch<PlaneWorkItem>(workspacePath(`/projects/${projectId}/work-items/${workItemId}/`))
}

// `key` is what the dashboard shows: PROJ-12.
export async function getPlaneWorkItemByKey(key: string): Promise<PlaneWorkItem> {
  return await planeFetch<PlaneWorkItem>(workspacePath(`/work-items/${encodeURIComponent(key)}/`))
}

export interface PlaneComment {
  id: string
  comment_html?: string | null
  actor?: PlaneUser | null
  created_at?: string
}

// Fetched instead of read from the webhook payload: the delivery carries only the stripped text, mentions are in the HTML.
export async function getPlaneComment(projectId: string, workItemId: string, commentId: string): Promise<PlaneComment> {
  return await planeFetch<PlaneComment>(workspacePath(`/projects/${projectId}/work-items/${workItemId}/comments/${commentId}/`))
}

export async function listPlaneComments(projectId: string, workItemId: string): Promise<PlaneComment[]> {
  return listAll<PlaneComment>(workspacePath(`/projects/${projectId}/work-items/${workItemId}/comments/`))
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
