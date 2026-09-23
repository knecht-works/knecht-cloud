import { describe, expect, it } from 'vitest'
import { withServer } from '../helpers/http-server'
import { getPlaneWorkItem, getPlaneWorkItemByKey } from '../../server/integrations/plane/api'
import { planeConnection } from '../../server/integrations/plane/credentials'

const json = (body: unknown) => (_req: unknown, res: { setHeader(k: string, v: string): void, end(s: string): void }) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

describe('plane api', () => {
  it('reads labels and assignees as ids whether Plane answers ids or expanded objects', async () => {
    await withServer({
      'GET /api/v1/workspaces/acme/work-items/PROJ-6/': json({ id: 'wi-6', sequence_id: 6, name: 'T', labels: [{ id: 'l-1', name: 'Bug' }], assignees: [{ id: 'u-knecht', display_name: 'hallo' }] }),
      'GET /api/v1/workspaces/acme/projects/p-1/work-items/wi-6/': json({ id: 'wi-6', sequence_id: 6, name: 'T', labels: ['l-1'], assignees: ['u-knecht'] }),
    }, async (origin) => {
      planeConnection.save({ siteUrl: origin, workspaceSlug: 'acme', apiKey: 'k' }, { accountName: 'Knecht', accountId: 'u-knecht' })
      expect(await getPlaneWorkItemByKey('PROJ-6')).toMatchObject({ labels: ['l-1'], assignees: ['u-knecht'] })
      expect(await getPlaneWorkItem('p-1', 'wi-6')).toMatchObject({ labels: ['l-1'], assignees: ['u-knecht'] })
      planeConnection.remove()
    })
  })
})
