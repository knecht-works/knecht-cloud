import { describe, expect, it } from 'vitest'
import { onTopics } from '../../server/utils/live'
import { appendRunLog, updateRun } from '../../server/stores/runs'
import { touchSessionPreview, updateSession } from '../../server/stores/sessions'
import { makeProject, makeRun } from '../helpers/db'

function nextBatch(): Promise<string[]> {
  return new Promise((resolve) => {
    const off = onTopics((topics) => {
      off()
      resolve(topics.sort())
    })
  })
}

describe('live topics', () => {
  it('coalesces the writes of one window into a single batch', async () => {
    const run = makeRun(makeProject(), [])
    const batch = nextBatch()
    updateRun(run.id, { branch: 'feature' })
    appendRunLog(run.id, 'line 1\n')
    appendRunLog(run.id, 'line 2\n')
    expect(await batch).toEqual(['run:' + run.id, 'runs'])
  })

  it('announces a session change on the runs of that session', async () => {
    const run = makeRun(makeProject(), [])
    const batch = nextBatch()
    updateSession(run.sessionId, { envState: 'up' })
    expect(await batch).toEqual(['run:' + run.id, 'runs'])
  })

  it('keeps preview heartbeats silent', async () => {
    const run = makeRun(makeProject(), [])
    let heard = false
    const off = onTopics(() => {
      heard = true
    })
    touchSessionPreview(run.sessionId)
    await new Promise(resolve => setTimeout(resolve, 200))
    off()
    expect(heard).toBe(false)
  })
})
