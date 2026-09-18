import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { makeProject } from '../helpers/db'

vi.mock('../../server/utils/github-app', () => ({}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
}))

const { db, schema } = await import('../../server/db')
const { INTEGRATIONS } = await import('../../server/integrations')
const { getTriggerSource } = await import('../../server/utils/trigger-sources')
const { defaultTriggerConfig, triggerSummary } = await import('../../shared/utils/trigger-form')
const { INPUT_KEYS } = await import('../../server/utils/inputs')
const { setProjectLink } = await import('../../server/utils/project-links')
const { saveGithubAppCredentials } = await import('../../server/utils/github-credentials')
const { jiraCredentials, saveJiraCredentials } = await import('../../server/integrations/jira/credentials')

let jiraKeys = 0

// Every integration gets the same drill: a signed delivery for a project of
// this instance, the trigger config that matches it, and a headers map.
interface Fixture {
  configure(): void
  secret(): string
  signatureHeader: string
  headers: Record<string, string>
  project: () => { id: number }
  body: (project: { githubId: number, jiraProjectKey: string }) => object
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
    configure: () => saveJiraCredentials({ siteUrl: 'https://acme.atlassian.net', email: 'k@acme.test', apiToken: 't', accountId: 'acc' }),
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
    const signature = sign(fixture.secret(), raw)
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
    for (const capability of ['label', 'setStatus'] as const) {
      const fn = integration.capabilities[capability]
      if (fn !== undefined) expect(typeof fn).toBe('function')
    }
    expect(typeof integration.mentions.allowsAuthor).toBe('function')
  })
})
