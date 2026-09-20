import type { Project } from '../db/schema'
import type { SessionObject } from '../utils/sessions'
import type { Integration } from './types'

const list = (names: string[]) => names.join(', ') || '(none)'

export async function applyLabels(integration: Integration, project: Project, object: SessionObject, add: string[], remove: string[]): Promise<string> {
  const labels = integration.capabilities.labels
  if (!labels) throw new Error(`labels are not supported for ${integration.objects.describe(object)}`)
  if (!add.length && !remove.length) throw new Error('nothing to do: pass labels to add or remove')
  const existing = await labels.list(project, object)
  const unknown = [...add, ...remove].filter(name => !existing.includes(name))
  if (unknown.length) {
    throw new Error(`these labels do not exist and Knecht never creates labels: ${list(unknown)}. Existing labels: ${list(existing)}`)
  }
  await labels.apply(project, object, add, remove)
  return [add.length ? `added ${add.join(', ')}` : '', remove.length ? `removed ${remove.join(', ')}` : ''].filter(Boolean).join('; ')
}

export async function moveToStatus(integration: Integration, project: Project, object: SessionObject, status: string): Promise<string> {
  const statuses = integration.capabilities.statuses
  if (!statuses) throw new Error(`setting a status is not supported for ${integration.objects.describe(object)}`)
  const targets = await statuses.targets(project, object)
  const target = targets.find(t => t.name.toLowerCase() === status.trim().toLowerCase())
  if (!target) throw new Error(`cannot move to "${status}". Reachable: ${list(targets.map(t => t.name))}`)
  await target.apply()
  return `moved to "${target.name}"`
}
