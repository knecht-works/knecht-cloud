import { describe, expect, it } from 'vitest'
import { db, schema } from '#server/db'
import { makeProject, makeRun, makeSession } from '../helpers/db'
import { getRunView } from '#server/stores/runs'

const at = (s: number) => new Date(s * 1000)

describe('run views: lastActivityAt', () => {
  it('is the latest timestamp across the session runs and follow-ups', () => {
    const project = makeProject()
    const session = makeSession(project)
    const first = makeRun(project, [], { sessionId: session.id, createdAt: at(1_000), finishedAt: at(1_100) })
    makeRun(project, [], { sessionId: session.id, createdAt: at(2_000), startedAt: at(2_050) })
    db.insert(schema.followups).values({ sessionId: session.id, runId: first.id, prompt: 'hi', createdAt: at(3_000), finishedAt: at(3_500) }).run()

    expect(getRunView(first.id)!.lastActivityAt).toEqual(at(3_500))
  })

  it('falls back to the run itself without follow-ups', () => {
    const project = makeProject()
    const run = makeRun(project, [], { createdAt: at(1_000), finishedAt: at(1_200) })

    expect(getRunView(run.id)!.lastActivityAt).toEqual(at(1_200))
  })
})
