import { describe, expect, it } from 'vitest'
import { databaseAt } from '../helpers/sql-migrations'

describe('0057_project-repo-provider', () => {
  it('keeps every project and turns its GitHub id into a github repo id', () => {
    const { sqlite, upgrade } = databaseAt('0056_followup-reply-to')
    sqlite.exec(`
      INSERT INTO workflows (name, steps) VALUES ('w', '[]');
      INSERT INTO projects (github_id, owner, name, full_name, default_branch, private, clone_url, favicon, starter_workflow_id, agent_instructions)
      VALUES (123456789, 'acme', 'app', 'acme/app', 'main', 1, 'https://github.com/acme/app.git', 'data:x', 1, 'be nice'),
             (42, 'acme', 'site', 'acme/site', 'develop', 0, 'https://github.com/acme/site.git', NULL, NULL, '');
      INSERT INTO sessions (project_id) VALUES (1);
      INSERT INTO runs (project_id, session_id, workflow, status) VALUES (1, 1, 'w', 'success');
      INSERT INTO run_steps (run_id, step_index, step_id, type, status) VALUES (1, 0, 's', 'bash', 'success');
      INSERT INTO followups (run_id, prompt, session_id) VALUES (1, 'again', 1);
      INSERT INTO project_links (project_id, integration, external_key) VALUES (1, 'jira', 'API');
    `)
    const children = () => ['sessions', 'runs', 'run_steps', 'followups', 'project_links']
      .map(table => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n)
    expect(children()).toEqual([1, 1, 1, 1, 1])

    upgrade()

    expect(sqlite.prepare('SELECT id, repo_provider, repo_id, owner, full_name, default_branch, private, favicon, starter_workflow_id, agent_instructions FROM projects ORDER BY id').all()).toEqual([
      { id: 1, repo_provider: 'github', repo_id: '123456789', owner: 'acme', full_name: 'acme/app', default_branch: 'main', private: 1, favicon: 'data:x', starter_workflow_id: 1, agent_instructions: 'be nice' },
      { id: 2, repo_provider: 'github', repo_id: '42', owner: 'acme', full_name: 'acme/site', default_branch: 'develop', private: 0, favicon: null, starter_workflow_id: null, agent_instructions: '' },
    ])
    expect(children()).toEqual([1, 1, 1, 1, 1])
    const columns = (sqlite.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(c => c.name)
    expect(columns).not.toContain('github_id')
    expect(columns).not.toContain('clone_url')
    expect(() => sqlite.exec(`INSERT INTO projects (repo_id, owner, name, full_name, default_branch) VALUES ('42', 'x', 'y', 'x/y', 'main')`)).toThrow(/UNIQUE/)
    sqlite.exec(`INSERT INTO projects (repo_id, owner, name, full_name, default_branch) VALUES ('43', 'x', 'y', 'x/y', 'main')`)
    expect(sqlite.prepare(`SELECT id FROM projects WHERE repo_id = '43'`).get()).toEqual({ id: 3 })
  })
})

describe('0060_member-identities', () => {
  it('gives every member a github identity, verified only once they have logged in', () => {
    const { sqlite, upgrade } = databaseAt('0059_trigger-roles')
    sqlite.exec(`
      INSERT INTO members (login, avatar_url, is_owner) VALUES ('owner', 'https://avatars/1', 1), ('invited', NULL, 0);
    `)

    upgrade()

    expect(sqlite.prepare('SELECT member_id, provider, subject, username, verified FROM member_identities ORDER BY member_id').all()).toEqual([
      { member_id: 1, provider: 'github', subject: null, username: 'owner', verified: 1 },
      { member_id: 2, provider: 'github', subject: null, username: 'invited', verified: 0 },
    ])
    sqlite.exec(`DELETE FROM members WHERE login = 'invited'`)
    expect(sqlite.prepare('SELECT count(*) AS n FROM member_identities').get()).toEqual({ n: 1 })
  })
})

describe('0067_mention-preview', () => {
  it('lets mentions of existing projects boot a preview and keeps their setup workflow', () => {
    const { sqlite, upgrade } = databaseAt('0066_preview-access')
    sqlite.exec(`
      INSERT INTO workflows (name, steps) VALUES ('w', '[]');
      INSERT INTO projects (repo_id, owner, name, full_name, default_branch, starter_workflow_id)
      VALUES ('1', 'acme', 'app', 'acme/app', 'main', 1);
    `)

    upgrade()

    expect(sqlite.prepare('SELECT starter_workflow_id, mention_preview FROM projects').all()).toEqual([
      { starter_workflow_id: 1, mention_preview: 1 },
    ])
  })
})
