import * as t from './trig.mjs'
const HOME = { w: 1440, h: 826 }
const TRIG = { url: '/workflows/26', w: 1440, h: 779 }
const onlyIntegration = name => async p => {
  const removed = await p.locator('main .gap-4\\.5').first().evaluate((list, name) => {
    let n = 0
    for (const card of [...list.children]) {
      if (card.innerText.trim().split('\n')[0].toLowerCase() !== name.toLowerCase()) { card.remove(); n++ }
    }
    return n
  }, name)
  if (removed !== 2) throw new Error(`expected to remove 2 panels, removed ${removed}`)
  await p.getByRole('button', { name: 'Show webhook' }).click()
  await p.waitForTimeout(400)
}
export default {
  dashboard: { url: '/', ...HOME },
  project: { url: '/projects/3', ...HOME },
  workflow: { url: '/workflows/10', ...HOME },
  'knecht-run': { url: '/projects/3', w: 1440, h: 900 },
  'knecht-run-follow-up': { url: '/runs/144', w: 1440, h: 900, act: async p => {
    const info = await p.getByText('Follow-up', { exact: true }).first().evaluate(el => {
      const out = []
      for (let e = el.parentElement; e; e = e.parentElement) {
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) {
          e.scrollTop += el.getBoundingClientRect().top - e.getBoundingClientRect().top - 12
          out.push(e.tagName + '.' + e.className.slice(0, 40))
        }
      }
      if (!out.length) { window.scrollBy(0, el.getBoundingClientRect().top - 12); out.push('window') }
      return out
    })
    await p.getByText('Can you implement a dark mode', { exact: false }).first().evaluate(el => {
      for (let e = el.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 0
    })
    const handles = p.locator('.cursor-row-resize')
    const h = await handles.nth(1).boundingBox()
    await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await p.mouse.down()
    await p.mouse.move(h.x + h.width / 2, h.y + 330, { steps: 10 })
    await p.mouse.up()
    await p.getByText('Can you implement a dark mode', { exact: false }).first().evaluate(el => {
      for (let e = el.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement)
        if (e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 0
    })
  } },
  'knecht-settings-user': { url: '/settings', w: 1440, h: 779 },
  'knecht-settings-ai': { url: '/settings/agent', w: 1440, h: 779 },
  'knecht-project-settings': { url: '/projects/2/settings', w: 1440, h: 900 },
  'knecht-integration-settings-jira': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Jira') },
  'knecht-integration-settings-plane': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Plane') },
  'knecht-integration-settings-linear': { url: '/settings/integrations', w: 1440, h: 779, act: onlyIntegration('Linear') },
  'knecht-project-settings-jira': { url: '/projects/2/settings/integrations', w: 1440, h: 779 },
  'knecht-trigger-github': { ...TRIG, act: async p => {
    await t.open(p, 'GitHub')
    await t.projects(p, ['knecht-works/test-laravel', 'knecht-works/test-craftcms'])
    for (const l of ['Opened', 'Ready for review', 'New commits pushed']) await t.check(p, l)
    await t.condition(p, 'Add condition', 'Base branch', 'is', ['main'])
    await t.condition(p, 'or group', 'Label', 'is', ['bug'])
  } },
  'knecht-trigger-github-issue': { ...TRIG, act: async p => {
    await t.open(p, 'GitHub')
    await t.projects(p, ['knecht-works/test-laravel', 'knecht-works/test-craftcms'])
    await t.dlg(p).getByRole('button', { name: 'Issue', exact: true }).click()
    await t.check(p, 'Opened')
    await t.check(p, 'Label added')
    await t.pick(p, p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(1), ['bug', 'enhancement'])
    await t.condition(p, 'Add condition', 'Author', 'is not', ['*[bot]'])
  } },
  'knecht-trigger-jira': { ...TRIG, act: async p => {
    await t.open(p, 'Jira')
    await t.projects(p, ['knecht-works/test-craftcms', 'knecht-works/test-php'])
    await t.check(p, 'Assigned to Knecht')
    await t.check(p, 'Label added')
    await t.pick(p, p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(1), ['knecht'])
    await t.condition(p, 'Add condition', 'Issue type', 'is', ['Bug'])
    await t.condition(p, 'and', 'Status', 'is not', ['Any Done'])
  } },
  'knecht-trigger-jira-status-error': { ...TRIG, act: async p => {
    await t.open(p, 'Jira')
    await t.projects(p, ['knecht-works/test-craftcms', 'knecht-works/test-php'])
    await t.dlg(p).getByLabel('Assigned to Knecht', { exact: true }).uncheck()
    await t.check(p, 'Status reached')
    await p.locator('[role=dialog] button[aria-haspopup="listbox"]').nth(1).click()
    await p.waitForTimeout(400)
    await p.getByRole('option', { name: 'Any Done', exact: true }).click()
    await p.getByRole('option', { name: /In Planning/ }).last().click()
    await p.keyboard.press('Escape')
  } },
  'knecht-trigger-linear': { ...TRIG, act: async p => {
    await t.open(p, 'Linear')
    await t.projects(p, ['knecht-works/test-craftcms'])
    await t.check(p, 'Created')
    await t.dlg(p).getByLabel('Assigned to Knecht', { exact: true }).uncheck()
    await t.condition(p, 'Add condition', 'Status', 'is', ['Any Triage'])
  } },
  'knecht-trigger-plane': { ...TRIG, act: async p => {
    await t.open(p, 'Plane')
    await t.projects(p, ['knecht-works/test-craftcms'])
    await t.check(p, 'Assigned to Knecht')
    await t.condition(p, 'Add condition', 'Label', 'is', ['Bug'])
    await t.condition(p, 'and', 'Priority', 'is', ['urgent'])
  } },
  'knecht-trigger-schedule': { ...TRIG, act: async p => {
    await t.open(p, 'Schedule')
    await t.projects(p, ['knecht-works/test-laravel', 'knecht-works/test-drupal11', 'knecht-works/test-craftcms'])
  } },
}
