import { execFileSync } from 'node:child_process'
import * as t from './trig.mjs'

const HOME = { w: 1440, h: 826 }
const TRIG = { url: '/workflows/10', w: 1440, h: 900 }
const onlyIntegration = name => async (p) => {
  const removed = await p.locator('main .gap-4\\.5').first().evaluate((list, name) => {
    let n = 0
    for (const card of [...list.children]) {
      if (card.innerText.trim().split('\n')[0].toLowerCase() !== name.toLowerCase()) {
        card.remove()
        n++
      }
    }
    return n
  }, name)
  if (removed !== 2) throw new Error(`expected to remove 2 panels, removed ${removed}`)
  const show = p.getByRole('button', { name: 'Show webhook' })
  if (await show.count()) await show.click()
  await p.waitForTimeout(400)
}
const onlyLink = name => async (p) => {
  const removed = await p.locator('main .gap-4\\.5').first().evaluate((list, name) => {
    let n = 0
    for (const card of [...list.children]) {
      if (card.innerText.trim().split('\n')[0].toLowerCase() !== name.toLowerCase()) {
        card.remove()
        n++
      }
    }
    return n
  }, name)
  if (removed !== 2) throw new Error(`expected to remove 2 panels, removed ${removed}`)
}
// Run against the marketing DB (npm run db:seed:marketing, then --rename). LIVE is the live boot session.
const LIVE = process.env.LIVE_SESSION
const DARK_MODE_SESSION = 9104
const P = { craft: 'goggle/search-homepage', laravel: 'mikrosoft/clippy-revival', drupal: 'nasaa/mars-landing-page', php: 'ikeaa/assembly-instructions' }
// Label and branch lists come from GitHub by the repo name, which the parody names break.
// The page has already loaded the parody names, so only the server sees the real ones.
const REAL = { 2: 'knecht-works/test-craftcms', 7: 'knecht-works/test-laravel' }
const sql = q => execFileSync('limactl', ['shell', 'knecht-dev', '--', 'bash', '-c', `sqlite3 $HOME/.knecht-dev/.data/marketing.db "${q}"`])
const setRepos = names => sql(Object.entries(names).map(([id, n]) => {
  const [owner, name] = n.split('/')
  return `update projects set owner = '${owner}', name = '${name}', full_name = '${n}' where id = ${id};`
}).join(' '))
const withRealRepos = act => async (p) => {
  setRepos(REAL)
  try {
    await act(p)
  }
  finally {
    setRepos({ 2: P.craft, 7: P.laravel })
  }
}
export default {
  'dashboard': { url: '/', ...HOME },
  'project': { url: '/projects/2', ...HOME },
  'workflow': { url: '/workflows/74', ...HOME },
  'sessions': { url: `/projects/2/sessions?session=${LIVE}`, ...HOME },
  'knecht-session-page': { url: `/projects/2/sessions?session=${LIVE}`, w: 1440, h: 900 },
  'knecht-run-follow-up': { url: `/projects/2/sessions?session=${DARK_MODE_SESSION}`, w: 1440, h: 900, act: async (p) => {
    await p.getByText('The environment is stopped', { exact: false }).last().evaluate(el => el.parentElement.remove())
    const h = await p.locator('.cursor-row-resize').first().boundingBox()
    await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await p.mouse.down()
    await p.mouse.move(h.x + h.width / 2, 140, { steps: 10 })
    await p.mouse.up()
    await p.waitForTimeout(400)
    await p.getByText('Can you add a dark mode toggle', { exact: false }).first().evaluate((el) => {
      for (let e = el.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement) {
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
          e.scrollTop += el.getBoundingClientRect().top - e.getBoundingClientRect().top - 16
          break
        }
      }
    })
    await p.getByText(/^follow-up$/i).first().evaluate((el) => {
      const main = document.querySelector('main')
      main.scrollTop += el.getBoundingClientRect().top - 24
    })
    const h2 = await p.locator('.cursor-row-resize').nth(1).boundingBox()
    await p.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2)
    await p.mouse.down()
    await p.mouse.move(h2.x + h2.width / 2, 880, { steps: 10 })
    await p.mouse.up()
    await p.waitForTimeout(400)
    await p.getByText('Can you add a dark mode toggle', { exact: false }).first().evaluate((el) => {
      for (let e = el.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
          e.scrollTop = 0
          break
        }
    })
  } },
  'knecht-settings-user': { url: '/settings', w: 1440, h: 779, act: async (p) => {
    if (!await p.getByText('Invite link', { exact: true }).count()) {
      await p.getByText('Create invite link', { exact: true }).click()
      const toast = p.locator('li').filter({ hasText: 'Invite link copied' }).first()
      await toast.waitFor()
      await toast.evaluate(el => el.remove())
    }
  } },
  'knecht-settings-members': { url: '/settings', w: 1440, h: 779, act: async (p) => {
    await p.getByText('Create invite link', { exact: true }).click()
    await p.waitForTimeout(1500)
    await p.getByRole('button').filter({ has: p.locator('[class*="ellipsis-vertical"]') }).first().click()
    await p.waitForTimeout(600)
  } },
  'knecht-settings-ai': { url: '/settings/agent', w: 1440, h: 779 },
  'knecht-project-settings': { url: '/projects/2/settings', w: 1440, h: 1024 },
  'knecht-integration-settings-jira': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Jira') },
  'knecht-integration-settings-plane': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Plane') },
  'knecht-integration-settings-linear': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Linear') },
  'knecht-project-settings-jira': { url: '/projects/2/settings/integrations', w: 1440, h: 620, act: onlyLink('Jira') },
  'knecht-project-settings-plane': { url: '/projects/2/settings/integrations', w: 1440, h: 620, act: onlyLink('Plane') },
  'knecht-project-settings-linear': { url: '/projects/2/settings/integrations', w: 1440, h: 620, act: onlyLink('Linear') },
  'knecht-trigger-github': { ...TRIG, act: withRealRepos(async (p) => {
    await t.open(p, 'GitHub', [P.laravel, P.craft])
    await t.check(p, 'Opened')
    await t.condition(p, 'Add condition', 'Base branch', 'is', ['main'])
    await t.condition(p, 'and', 'Author', 'is not', ['renovate[bot]'])
  }) },
  'knecht-trigger-github-issue': { ...TRIG, act: withRealRepos(async (p) => {
    await t.open(p, 'GitHub', [P.laravel, P.craft])
    await t.dlg(p).getByRole('button', { name: 'Issue', exact: true }).click()
    await t.check(p, 'Label added')
    await t.pick(p, p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(2), ['bug', 'enhancement'])
    await t.condition(p, 'Add condition', 'Author', 'is not', ['*[bot]'])
  }) },
  'knecht-trigger-jira': { ...TRIG, act: async (p) => {
    await t.open(p, 'Jira', [P.craft])
    await t.check(p, 'Label added')
    await t.pick(p, p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(2), ['knecht'])
    await t.scope(p, ['Any To Do'])
    await t.condition(p, 'Add condition', 'Issue type', 'is', ['Bug'])
  } },
  'knecht-trigger-jira-status-error': { ...TRIG, act: async (p) => {
    await t.open(p, 'Jira', [P.craft, P.php])
    await t.check(p, 'Status reached')
    await p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(2).click()
    await p.waitForTimeout(600)
    await p.getByRole('option', { name: /In Planning/ }).last().hover()
  } },
  'knecht-trigger-linear': { ...TRIG, act: async (p) => {
    await t.open(p, 'Linear', [P.craft])
    await t.check(p, 'Created')
    await t.scope(p, ['Any Triage'])
  } },
  'knecht-trigger-plane': { ...TRIG, act: async (p) => {
    await t.open(p, 'Plane', [P.craft])
    await t.check(p, 'Assigned to Knecht')
    await t.condition(p, 'Add condition', 'Label', 'is', ['Bug'])
    await t.condition(p, 'and', 'Priority', 'is', ['urgent'])
  } },
  'knecht-trigger-schedule': { ...TRIG, act: async (p) => {
    await t.open(p, 'Schedule', [P.laravel, P.drupal, P.craft])
  } },
  // Not knecht-mcp-servers.png: the updates use that one.
  'knecht-mcp-servers-project': { url: '/projects/2/settings/agent', w: 1440, h: 779, act: async (p) => {
    await p.getByText(/^MCP servers$/i).first().evaluate((el) => {
      const card = el.closest('.k-card')
      for (const c of [...card.parentElement.children]) if (c !== card) c.remove()
    })
  } },
}
