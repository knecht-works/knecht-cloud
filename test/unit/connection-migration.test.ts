import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const DIR = 'server/db/migrations'
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()

function apply(db: Database.Database, from: number, to: number) {
  for (const file of files.slice(from, to)) {
    for (const statement of readFileSync(join(DIR, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement)
    }
  }
}

describe('migration to integration_connections', () => {
  it('carries the Jira and Plane connections over, ciphertexts untouched', () => {
    const db = new Database(':memory:')
    const at = files.findIndex(f => f.startsWith('0046_'))
    apply(db, 0, at)
    db.prepare(`INSERT INTO jira_connection (id, site_url, email, api_token_enc, account_name, account_id, webhook_secret_enc, last_delivery_at, last_delivery_summary, created_at) VALUES (1, 'https://acme.atlassian.net', 'k@acme.test', 'enc-token', 'Knecht', 'acc-1', 'enc-secret', 1700000000, 'jira:issue_created P-1', 1690000000)`).run()
    db.prepare(`INSERT INTO plane_connection (id, site_url, workspace_slug, api_key_enc, webhook_secret_enc, last_rejected_at, last_rejected_reason) VALUES (1, 'https://app.plane.so', 'acme', 'enc-key', NULL, 1700000001, 'signature')`).run()

    apply(db, at, files.length)

    const rows = db.prepare('SELECT * FROM integration_connections ORDER BY integration').all() as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      integration: 'jira',
      account_name: 'Knecht',
      account_id: 'acc-1',
      webhook_secret_enc: 'enc-secret',
      last_delivery_at: 1700000000,
      last_delivery_summary: 'jira:issue_created P-1',
      created_at: 1690000000,
    })
    expect(JSON.parse(rows[0]!.config as string)).toEqual({ siteUrl: 'https://acme.atlassian.net', email: 'k@acme.test' })
    expect(JSON.parse(rows[0]!.secrets_enc as string)).toEqual({ apiToken: 'enc-token' })
    expect(rows[1]).toMatchObject({ integration: 'plane', webhook_secret_enc: null, last_rejected_at: 1700000001, last_rejected_reason: 'signature' })
    expect(JSON.parse(rows[1]!.config as string)).toEqual({ siteUrl: 'https://app.plane.so', workspaceSlug: 'acme' })
    expect(JSON.parse(rows[1]!.secrets_enc as string)).toEqual({ apiKey: 'enc-key' })
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('jira_connection', 'plane_connection')`).all()).toEqual([])
  })

  it('migrates an instance without connections', () => {
    const db = new Database(':memory:')
    apply(db, 0, files.length)
    expect(db.prepare('SELECT count(*) AS n FROM integration_connections').get()).toEqual({ n: 0 })
  })
})
