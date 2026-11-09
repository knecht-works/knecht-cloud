import * as t from './trig.mjs'

const HOME = { w: 1440, h: 826 }
const TRIG = { url: '/workflows/26', w: 1440, h: 779 }
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
  await p.getByRole('button', { name: 'Show webhook' }).click()
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
export default {
  'dashboard': { url: '/', ...HOME },
  'project': { url: '/projects/2', ...HOME },
  'workflow': { url: '/workflows/74', ...HOME },
  'running-workflow': { url: '/workflows/74', ...HOME },
  'knecht-run': { url: '/projects/3', w: 1440, h: 900 },
  'knecht-run-follow-up': { url: '/runs/312', w: 1440, h: 900, act: async (p) => {
    await p.getByText('Follow-up', { exact: true }).first().evaluate((el) => {
      const out = []
      for (let e = el.parentElement; e; e = e.parentElement) {
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
          e.scrollTop += el.getBoundingClientRect().top - e.getBoundingClientRect().top - 12
          out.push(e.tagName + '.' + e.className.slice(0, 40))
        }
      }
      if (!out.length) {
        window.scrollBy(0, el.getBoundingClientRect().top - 12)
        out.push('window')
      }
      return out
    })
    await p.getByText('Can you add a dark mode toggle', { exact: false }).first().evaluate((el) => {
      for (let e = el.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 0
    })
    const handles = p.locator('.cursor-row-resize')
    const h = await handles.nth(1).boundingBox()
    await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await p.mouse.down()
    await p.mouse.move(h.x + h.width / 2, h.y + 330, { steps: 10 })
    await p.mouse.up()
    await p.getByText('Can you add a dark mode toggle', { exact: false }).first().evaluate((el) => {
      for (let e = el.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 0
    })
  } },
  'knecht-settings-user': { url: '/settings', w: 1440, h: 779 },
  'knecht-settings-members': { url: '/settings', w: 1440, h: 779, act: async (p) => {
    await p.getByText('Create invite link', { exact: true }).click()
    await p.waitForTimeout(1500)
    await p.getByRole('button').filter({ has: p.locator('[class*="ellipsis-vertical"]') }).first().click()
    await p.waitForTimeout(600)
  } },
  'knecht-settings-ai': { url: '/settings/agent', w: 1440, h: 779 },
  'knecht-project-settings': { url: '/projects/2/settings', w: 1440, h: 1080 },
  'knecht-integration-settings-jira': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Jira') },
  'knecht-integration-settings-plane': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Plane') },
  'knecht-integration-settings-linear': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Linear') },
  'knecht-project-settings-jira': { url: '/projects/2/settings/integrations', w: 1440, h: 620, act: onlyLink('Jira') },
  'knecht-project-settings-plane': { url: '/projects/2/settings/integrations', w: 1440, h: 620, act: onlyLink('Plane') },
  'knecht-project-settings-linear': { url: '/projects/2/settings/integrations', w: 1440, h: 620, act: onlyLink('Linear') },
  'knecht-trigger-github': { ...TRIG, act: async (p) => {
    await t.open(p, 'GitHub', ['knecht-works/test-laravel', 'knecht-works/test-craftcms'])
    await t.check(p, 'Ready for review')
    await t.condition(p, 'Add condition', 'Base branch', 'is', ['main'])
    await t.condition(p, 'and', 'Label', 'is', ['bug'])
  } },
  'knecht-trigger-github-issue': { ...TRIG, act: async (p) => {
    await t.open(p, 'GitHub', ['knecht-works/test-laravel', 'knecht-works/test-craftcms'])
    await t.dlg(p).getByRole('button', { name: 'Issue', exact: true }).click()
    await t.check(p, 'Label added')
    await t.pick(p, p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(1), ['bug', 'enhancement'])
    await t.condition(p, 'Add condition', 'Author', 'is not', ['*[bot]'])
  } },
  'knecht-trigger-jira': { ...TRIG, act: async (p) => {
    await t.open(p, 'Jira', ['knecht-works/test-craftcms'])
    await t.check(p, 'Label added')
    await t.pick(p, p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(1), ['knecht'])
    await t.scope(p, ['Any To Do'])
    await t.condition(p, 'Add condition', 'Issue type', 'is', ['Bug'])
  } },
  'knecht-trigger-jira-status-error': { ...TRIG, act: async (p) => {
    await t.open(p, 'Jira', ['knecht-works/test-craftcms', 'knecht-works/test-php'])
    await t.check(p, 'Status reached')
    await p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(1).click()
    await p.waitForTimeout(600)
    await p.getByRole('option', { name: /In Planning/ }).last().hover()
  } },
  'knecht-trigger-linear': { ...TRIG, act: async (p) => {
    await t.open(p, 'Linear', ['knecht-works/test-craftcms'])
    await t.check(p, 'Created')
    await t.scope(p, ['Any Triage'])
  } },
  'knecht-trigger-plane': { ...TRIG, act: async (p) => {
    await t.open(p, 'Plane', ['knecht-works/test-craftcms'])
    await t.check(p, 'Assigned to Knecht')
    await t.condition(p, 'Add condition', 'Label', 'is', ['Bug'])
    await t.condition(p, 'and', 'Priority', 'is', ['urgent'])
  } },
  'knecht-trigger-schedule': { ...TRIG, act: async (p) => {
    await t.open(p, 'Schedule', ['knecht-works/test-laravel', 'knecht-works/test-drupal11', 'knecht-works/test-craftcms'])
  } },
}
