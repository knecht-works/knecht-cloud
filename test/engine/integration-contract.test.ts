import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { makeProject } from '../helpers/db'

vi.mock('../../server/utils/github-app', () => ({}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
}))
const planeProjects = vi.hoisted(() => [] as { id: string, identifier: string, name: string }[])
vi.mock('../../server/integrations/plane/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/plane/api')>(),
  listPlaneProjects: async () => planeProjects,
  planeProjectById: async (id: string) => planeProjects.find(p => p.id === id),
  getPlaneWorkItem: async (_projectId: string, id: string) => ({ id, sequence_id: 1, name: 'T', description_html: '<p>B</p>', state: 's1', labels: [], assignees: [], created_by: 'u1' }),
  listPlaneStates: async () => [{ id: 's1', name: 'Todo', group: 'unstarted' }],
  listPlaneLabels: async () => [],
  listPlaneMembers: async () => [{ id: 'u1', displayName: 'Ann' }],
}))

const { db, schema } = await import('../../server/db')
const { INTEGRATIONS } = await import('../../server/integrations')
const { getTriggerSource } = await import('../../server/utils/trigger-sources')
const { defaultTriggerConfig, triggerSummary } = await import('../../shared/utils/trigger-form')
const { INPUT_KEYS } = await import('../../server/utils/inputs')
const { setProjectLink } = await import('../../server/utils/project-links')
const { saveGithubAppCredentials } = await import('../../server/utils/github-credentials')
const { jiraConnection, jiraCredentials } = await import('../../server/integrations/jira/credentials')
const { planeConnection } = await import('../../server/integrations/plane/credentials')

let jiraKeys = 0
let planeKeys = 0

// Every integration gets the same drill: a signed delivery for a project of
// this instance, the trigger config that matches it, and a headers map.
interface Fixture {
  configure(): void
  secret(): string
  signatureHeader: string
  // GitHub and Jira prefix the digest with `sha256=`, Plane sends the bare hex.
  sign?: (secret: string, raw: string) => string
  headers: Record<string, string>
  project: () => { id: number }
  body: (project: { githubId: number, jiraProjectKey: string, planeProjectId: string }) => object
  unknownBody: object
  triggerConfig: TriggerConfig
}

const FIXTURES: Record<string, Fixture> = {
  github: {
    configure: () => saveGithubAppCredentials({ appId: '1', clientId: 'c', clientSecret: 'x', privateKey: 'x', webhookSecret: 'gh-secret' }),
    secret: () => 'gh-secret',
    signatureHeader: 'x-hub-signature-256',
    headers: { 'x-github-event': 'issues' },
    project: () => makeProject(),
    body: p => ({ action: 'opened', issue: { number: 1, title: 'T', body: 'B', html_url: 'https://x/1' }, repository: { id: p.githubId } }),
    unknownBody: { action: 'opened', repository: { id: 424242 } },
    triggerConfig: { kind: 'issue', on: [{ type: 'opened' }], filters: {} },
  },
  jira: {
    configure: () => jiraConnection.save({ siteUrl: 'https://acme.atlassian.net', email: 'k@acme.test', apiToken: 't' }, { accountId: 'acc' }),
    secret: () => jiraCredentials()!.webhookSecret!,
    signatureHeader: 'x-hub-signature',
    headers: {},
    project: () => {
      const project = makeProject()
      const jiraProjectKey = `CONTRACT${++jiraKeys}`
      setProjectLink(project.id, 'jira', jiraProjectKey)
      return { ...project, jiraProjectKey }
    },
    body: p => ({ webhookEvent: 'jira:issue_created', issue: { key: `${p.jiraProjectKey}-1`, fields: { summary: 'T', project: { key: p.jiraProjectKey } } } }),
    unknownBody: { webhookEvent: 'jira:issue_created', issue: { key: 'X-1', fields: { project: { key: 'X' } } } },
    triggerConfig: { kind: 'issue', on: [{ type: 'created' }], filters: {} },
  },
  plane: {
    configure: () => planeConnection.save({ siteUrl: 'https://app.plane.so', workspaceSlug: 'acme', apiKey: 'k' }, { webhookSecret: 'plane-secret', accountId: 'acc' }),
    secret: () => 'plane-secret',
    signatureHeader: 'x-plane-signature',
    sign: (secret, raw) => createHmac('sha256', secret).update(raw).digest('hex'),
    headers: {},
    project: () => {
      const project = makeProject()
      const identifier = `CONTRACT${++planeKeys}`
      const planeProjectId = `pp-${identifier}`
      planeProjects.push({ id: planeProjectId, identifier, name: identifier })
      setProjectLink(project.id, 'plane', identifier)
      return { ...project, planeProjectId }
    },
    body: p => ({ event: 'workitem.created', data: { id: 'wi-1', name: 'T', sequence_id: 1, project_id: p.planeProjectId, state_id: 's1', label_ids: [], assignee_ids: [], created_by_id: 'u1' }, previous_attributes: {} }),
    unknownBody: { event: 'workitem.created', data: { id: 'wi-1', sequence_id: 1, project_id: 'pp-NOPE' }, previous_attributes: {} },
    triggerConfig: { kind: 'issue', on: [{ type: 'created' }], filters: {} },
  },
}

function sign(secret: string, raw: string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
}

describe.each(INTEGRATIONS.map(i => [i.id, i] as const))('integration contract: %s', (id, integration) => {
  const fixture = FIXTURES[id]!
  const headers = (extra: Record<string, string>) => (name: string) => ({ ...fixture.headers, ...extra })[name]

  beforeAll(() => {
    fixture.configure()
  })

  it('is configured once its connection exists', () => {
    expect(integration.isConfigured()).toBe(true)
  })

  it('verifies the signature over the raw body and rejects tampering', () => {
    const raw = JSON.stringify(fixture.unknownBody)
    const signature = (fixture.sign ?? sign)(fixture.secret(), raw)
    expect(integration.webhook.verify(raw, headers({ [fixture.signatureHeader]: signature }))).toBe(true)
    expect(integration.webhook.verify(`${raw} `, headers({ [fixture.signatureHeader]: signature }))).toBe(false)
    expect(integration.webhook.verify(raw, headers({}))).toBe(false)
  })

  it('parses a delivery for a known project and null for an unknown one', async () => {
    const project = fixture.project()
    const raw = JSON.stringify(fixture.body(project as never))
    const delivery = await integration.webhook.parse(raw, headers({}))
    expect(delivery?.project.id).toBe(project.id)
    expect(delivery?.summary).toBeTruthy()
    expect(await integration.webhook.parse(JSON.stringify(fixture.unknownBody), headers({}))).toBeNull()
  })

  it('matches a trigger with every input key filled', async () => {
    const project = fixture.project()
    const delivery = (await integration.webhook.parse(JSON.stringify(fixture.body(project as never)), headers({})))!
    const trigger = db.insert(schema.triggers).values({
      source: id,
      workflowId: db.insert(schema.workflows).values({ name: `contract-${id}`, steps: [] }).returning().get().id,
      projectIds: [project.id],
      config: { ...fixture.triggerConfig },
    }).returning().get()
    const match = await integration.webhook.match(trigger, delivery)
    expect(match).not.toBeNull()
    expect(Object.keys(match!.inputs).sort()).toEqual([...INPUT_KEYS].sort())
    expect(Object.values(match!.inputs).every(v => typeof v === 'string')).toBe(true)
    expect(match!.object?.integration).toBe(id)
    expect(integration.objects.kinds).toContain(match!.object?.kind)
  })

  it('declares a trigger form its config validates against', () => {
    const source = getTriggerSource(id)!
    expect(source.configSchema.safeParse(fixture.triggerConfig).success).toBe(true)
    expect(source.configSchema.safeParse({ ...fixture.triggerConfig, on: [] }).success).toBe(false)
    expect(triggerSummary(integration.trigger.form, fixture.triggerConfig)).toMatch(/^On /)
    for (const kind of integration.trigger.form) {
      expect(integration.objects.kinds).toContain(kind.kind)
      expect(source.configSchema.safeParse(defaultTriggerConfig(integration.trigger.form, kind.kind)).success).toBe(kind.events.some(e => e.default))
    }
  })

  it('describes objects and declares callable capabilities', () => {
    for (const kind of integration.objects.kinds) {
      expect(integration.objects.describe({ integration: id, kind, key: '7' })).toContain('7')
    }
    expect(typeof integration.capabilities.comment).toBe('function')
    expect(typeof integration.objects.context).toBe('function')
    const { labels, statuses } = integration.capabilities
    if (labels) expect(typeof labels.apply).toBe('function')
    if (statuses) expect(typeof statuses.targets).toBe('function')
    expect(typeof integration.mentions.allowsAuthor).toBe('function')
  })
})
