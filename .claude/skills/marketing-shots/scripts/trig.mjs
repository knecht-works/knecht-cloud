export const dlg = p => p.getByRole('dialog')
export async function open(p, source) {
  await p.getByRole('button', { name: /add trigger/i }).click()
  await dlg(p).getByRole('button', { name: source, exact: true }).click()
  await p.waitForTimeout(300)
}
export async function projects(p, names) {
  await dlg(p).getByText('Select projects…').click()
  for (const n of names) await p.getByRole('option', { name: n, exact: true }).click()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
}
export async function check(p, label) { await dlg(p).getByLabel(label, { exact: true }).check() }
export async function pick(p, combo, opts) {
  await combo.click()
  await p.waitForTimeout(300)
  const searchable = await p.evaluate(() => document.activeElement?.tagName === 'INPUT')
  for (const o of opts) {
    if (searchable) { await p.keyboard.press('ControlOrMeta+a'); await p.keyboard.type(o); await p.waitForTimeout(600) }
    const exact = p.getByRole('option', { name: o, exact: true })
    if (await exact.count()) await exact.first().click()
    else await p.getByRole('option', { name: `Create "${o}"` }).click()
  }
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
}
export async function condition(p, button, field, op, values) {
  await dlg(p).getByRole('button', { name: button, exact: true }).last().click()
  await p.getByRole('menuitem', { name: field, exact: true }).click()
  await p.waitForTimeout(200)
  const combos = p.locator('button[aria-haspopup="listbox"]')
  const n = await combos.count()
  if (op && op !== 'is') await pick(p, combos.nth(n - 2), [op])
  await pick(p, combos.nth(n - 1), values)
}
