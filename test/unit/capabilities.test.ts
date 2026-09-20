import { describe, expect, it } from 'vitest'
import { applyLabels, moveToStatus } from '../../server/integrations/capabilities'
import type { Project } from '../../server/db/schema'
import type { Integration } from '../../server/integrations/types'
import type { SessionObject } from '../../server/utils/sessions'

const project = {} as Project
const object: SessionObject = { integration: 'jira', kind: 'issue', key: 'P-1' }

function integration(capabilities: Partial<Integration['capabilities']>): Integration {
  return { objects: { describe: (o: SessionObject) => `ticket ${o.key}` }, capabilities } as unknown as Integration
}

describe('applyLabels', () => {
  it('refuses labels the tool does not know, for adding and removing', async () => {
    const applied: string[][] = []
    const tracker = integration({ labels: { list: async () => ['bug', 'backend'], apply: async (_p, _o, add, remove) => void applied.push(add, remove) } })
    await expect(applyLabels(tracker, project, object, ['nope'], ['bug'])).rejects.toThrow('do not exist and Knecht never creates labels: nope. Existing labels: bug, backend')
    await expect(applyLabels(tracker, project, object, [], ['gone'])).rejects.toThrow('gone')
    expect(applied).toEqual([])
    expect(await applyLabels(tracker, project, object, ['backend'], ['bug'])).toBe('added backend; removed bug')
    expect(applied).toEqual([['backend'], ['bug']])
  })

  it('refuses an empty request and tools without labels', async () => {
    await expect(applyLabels(integration({ labels: { list: async () => [], apply: async () => {} } }), project, object, [], [])).rejects.toThrow('nothing to do')
    await expect(applyLabels(integration({}), project, object, ['bug'], [])).rejects.toThrow('labels are not supported for ticket P-1')
  })
})

describe('moveToStatus', () => {
  it('moves to the target whose name matches, whatever the case, and lists the targets otherwise', async () => {
    const moved: string[] = []
    const tracker = integration({
      statuses: { targets: async () => ['In Progress', 'In Review'].map(name => ({ name, apply: async () => void moved.push(name) })) },
    })
    expect(await moveToStatus(tracker, project, object, ' in review ')).toBe('moved to "In Review"')
    expect(moved).toEqual(['In Review'])
    await expect(moveToStatus(tracker, project, object, 'Shipped')).rejects.toThrow('cannot move to "Shipped". Reachable: In Progress, In Review')
    await expect(moveToStatus(integration({}), project, object, 'Done')).rejects.toThrow('setting a status is not supported for ticket P-1')
  })
})
