import { ofetch } from 'ofetch'
import { createGraphqlClient, createVendorCache, createVendorFetch } from '../vendor-fetch'
import { linearCredentials } from './credentials'

interface LinearAuth {
  apiKey: string
}

const linearFetch = createVendorFetch<LinearAuth>({
  name: 'Linear',
  credentials: linearCredentials,
  baseUrl: () => 'https://api.linear.app',
  // A personal API key goes in bare; only OAuth tokens take the Bearer prefix.
  headers: auth => ({ Authorization: auth.apiKey }),
})

const { query: linearQuery, mutate: linearMutate } = createGraphqlClient('Linear', linearFetch)

interface Page<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean, endCursor: string | null }
}

async function listAll<T>(load: (after: string | null) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = []
  let after: string | null = null
  do {
    const page = await load(after)
    items.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)
  return items
}

const { cached, forget: forgetLinearCache } = createVendorCache(60_000)
export { forgetLinearCache }

export async function linearMyself(auth?: LinearAuth): Promise<{ displayName: string, accountId: string }> {
  const { viewer } = await linearQuery<{ viewer: { id: string, name?: string } }>('query { viewer { id name } }', {}, auth)
  return { displayName: viewer.name || 'Unknown account', accountId: viewer.id }
}

export interface LinearTeam {
  key: string
  name: string
}

export function listLinearTeams(): Promise<LinearTeam[]> {
  return cached('teams', () => listAll(async after => (await linearQuery<{ teams: Page<LinearTeam> }>(
    'query($after: String) { teams(first: 250, after: $after) { nodes { key name } pageInfo { hasNextPage endCursor } } }',
    { after },
  )).teams))
}

export interface LinearState {
  id: string
  name: string
  type: string
}

export function listLinearStates(teamKey: string): Promise<LinearState[]> {
  return cached(`states:${teamKey}`, () => listAll(async after => (await linearQuery<{ workflowStates: Page<LinearState> }>(
    'query($team: String!, $after: String) { workflowStates(first: 250, after: $after, filter: { team: { key: { eq: $team } } }) { nodes { id name type } pageInfo { hasNextPage endCursor } } }',
    { team: teamKey, after },
  )).workflowStates))
}

export interface LinearLabel {
  id: string
  name: string
}

// A team's issues take its own labels and the workspace's. A label group holds labels and cannot be applied itself.
export function listLinearLabels(teamKey: string): Promise<LinearLabel[]> {
  return cached(`labels:${teamKey}`, async () => {
    const labels = await listAll(async after => (await linearQuery<{ issueLabels: Page<LinearLabel & { isGroup?: boolean }> }>(
      'query($team: String!, $after: String) { issueLabels(first: 250, after: $after, filter: { or: [{ team: { key: { eq: $team } } }, { team: { null: true } }] }) { nodes { id name isGroup } pageInfo { hasNextPage endCursor } } }',
      { team: teamKey, after },
    )).issueLabels)
    return labels.filter(l => !l.isGroup).map(l => ({ id: l.id, name: l.name }))
  })
}

const ISSUE_FIELDS = `
  id identifier title description url priority
  state { name type }
  creator { id name displayName }
  assignee { id name displayName }
  labels { nodes { id name } }
`

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string | null
  url: string
  priority?: number | null
  state?: { name: string, type: string } | null
  creator?: { id?: string, name?: string, displayName?: string } | null
  assignee?: { id: string, name?: string, displayName?: string } | null
  labels?: { nodes: LinearLabel[] } | null
}

// `id` is the UUID of a delivery or the identifier the dashboard shows: ENG-12.
export async function getLinearIssue(id: string): Promise<LinearIssue> {
  return (await linearQuery<{ issue: LinearIssue }>(`query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id })).issue
}

interface LinearRef {
  identifier: string
  title: string
}

export interface LinearIssueRaw {
  identifier: string
  title: string
  description?: string | null
  url: string
  priorityLabel?: string | null
  state?: { name: string } | null
  assignee?: { name?: string } | null
  parent?: LinearRef | null
  children: { nodes: LinearRef[] }
  relations: { nodes: { type: string, relatedIssue: LinearRef }[] }
  inverseRelations: { nodes: { type: string, issue: LinearRef }[] }
  comments: { nodes: { body?: string | null }[] }
}

// GraphQL has no "every field": this is what the issue view in Linear shows.
export async function getLinearIssueRaw(id: string): Promise<LinearIssueRaw> {
  return (await linearQuery<{ issue: LinearIssueRaw }>(`query($id: String!) { issue(id: $id) {
    id identifier title description url priority priorityLabel estimate dueDate createdAt updatedAt startedAt completedAt canceledAt
    state { name type } team { key name } project { name } cycle { number name } projectMilestone { name }
    creator { name displayName } assignee { name displayName } subscribers { nodes { name displayName } }
    labels { nodes { name } }
    parent { identifier title } children { nodes { identifier title } }
    relations { nodes { type relatedIssue { identifier title } } }
    inverseRelations { nodes { type issue { identifier title } } }
    attachments { nodes { title subtitle url sourceType createdAt } }
    comments(first: 250) { nodes { id body createdAt updatedAt user { name displayName } parent { id } } }
  } }`, { id })).issue
}

const UPLOAD_ORIGIN = 'https://uploads.linear.app/'

// Uploads live on their own host and take the same key.
export async function downloadLinearUpload(url: string): Promise<Buffer> {
  const auth = linearCredentials()
  if (!auth) throw new Error('Linear is not connected')
  if (!url.startsWith(UPLOAD_ORIGIN)) throw new Error(`not a Linear upload: ${url}`)
  return Buffer.from(await ofetch<ArrayBuffer, 'arrayBuffer'>(url, { headers: { Authorization: auth.apiKey }, responseType: 'arrayBuffer', timeout: 60_000 }))
}

export interface LinearComment {
  id: string
  body?: string | null
  bodyData?: string | null
  createdAt?: string
  user?: { id: string, name?: string, displayName?: string } | null
  parent?: { id: string } | null
  // Null for a comment on a project update or a document.
  issue?: LinearIssue | null
}

// Fetched instead of read from the webhook payload: the delivery names neither the mentioned users nor the issue's identifier.
export async function getLinearComment(id: string): Promise<LinearComment> {
  return (await linearQuery<{ comment: LinearComment }>(
    `query($id: String!) { comment(id: $id) { id body bodyData user { id name } parent { id } issue { ${ISSUE_FIELDS} } } }`,
    { id },
  )).comment
}

export async function listLinearComments(issueId: string): Promise<LinearComment[]> {
  const { issue } = await linearQuery<{ issue: { comments: { nodes: LinearComment[] } } }>(
    'query($id: String!) { issue(id: $id) { comments(first: 250) { nodes { id body createdAt user { id name displayName } } } } }',
    { id: issueId },
  )
  return issue.comments.nodes.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}

export async function addLinearComment(issueId: string, body: string, parentId?: string | null): Promise<{ url?: string }> {
  const { commentCreate } = await linearMutate<{ commentCreate: { comment?: { url?: string } } }>(
    'mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { url } } }',
    { input: { issueId, body, ...(parentId ? { parentId } : {}) } },
  )
  return { url: commentCreate.comment?.url }
}

// The handle ("samuelreichor"), not the full name: Linear turns "@handle" in a markdown body into a mention.
export function getLinearHandle(userId: string): Promise<string> {
  return cached(`handle:${userId}`, async () => (await linearQuery<{ user: { displayName?: string } }>(
    'query($id: String!) { user(id: $id) { displayName } }',
    { id: userId },
  )).user.displayName ?? '')
}

export async function updateLinearIssue(id: string, input: { stateId?: string, assigneeId?: string | null, addedLabelIds?: string[], removedLabelIds?: string[] }): Promise<void> {
  await linearMutate('mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', { id, input })
}
