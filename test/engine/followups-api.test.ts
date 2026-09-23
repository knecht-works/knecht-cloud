import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject, makeRun } from '../helpers/db'
import type { LiveEvent } from '../../server/utils/live'

const started: number[] = []
vi.mock('../../server/daemon/followups', () => ({
  startFollowup: async (id: number) => {
    started.push(id)
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))
Object.assign(globalThis, { requireUserSession: async () => ({ user: { login: 'samuelreichor' } }) })

const { db, schema } = await import('../../server/db')
const { onLive } = await import('../../server/utils/live')
const { PUBLISH_FOLLOWUP_PROMPT } = await import('../../shared/utils/followup')
const { followupAttachmentsDir } = await import('../../server/utils/attachments')
const handler = (await import('../../server/api/runs/[id]/followups.post')).default
const deleteHandler = (await import('../../server/api/followups/[id].delete')).default
const transcriptHandler = (await import('../../server/api/sessions/[id]/transcript.get')).default
const attachmentHandler = (await import('../../server/api/followups/[id]/attachments/[name].get')).default
const retryHandler = (await import('../../server/api/followups/[id]/retry.post')).default

function post(runId: number, body: Record<string, unknown> = { prompt: 'more' }) {
  return callRoute(handler, { route: '/runs/:id/followups', path: `/runs/${runId}/followups`, body })
}

function liveRun(status: 'success' | 'failed' | 'running' | 'queued' | 'cancelled', envState: 'up' | 'stopped' | 'down' = 'up') {
  const run = makeRun(makeProject(), [], { status })
  db.update(schema.sessions).set({ envState }).where(eq(schema.sessions.id, run.sessionId)).run()
  return run
}

describe('POST /api/runs/:id/followups', () => {
  it('queues a follow-up while the run is still running, for the dispatcher to start later', async () => {
    const run = liveRun('running')
    const res = await post(run.id)
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ status: 'queued', runId: run.id, requestedBy: 'samuelreichor' })
    expect(started).not.toContain((res.json as { id: number }).id)
  })

  it('accepts a queued run whose environment does not exist yet', async () => {
    const res = await post(liveRun('queued', 'down').id)
    expect(res.status).toBe(200)
  })

  it('starts right away on a finished run with a live environment, but not behind queued work', async () => {
    const run = liveRun('success')
    const first = await post(run.id)
    expect(started).toContain((first.json as { id: number }).id)
    const second = await post(run.id)
    expect(second.status).toBe(200)
    expect(started).not.toContain((second.json as { id: number }).id)
  })

  it('refuses cancelled runs and finished runs whose environment is gone', async () => {
    expect((await post(liveRun('cancelled').id)).status).toBe(409)
    expect((await post(liveRun('success', 'down').id)).status).toBe(409)
  })

  it('accepts a follow-up on a cancelled mention run: the conversation goes on', async () => {
    const run = liveRun('cancelled')
    db.update(schema.runs).set({ kind: 'mention' }).where(eq(schema.runs.id, run.id)).run()
    expect((await post(run.id)).status).toBe(200)
  })
})

describe('chat commands and options', () => {
  it('/clear finishes on the spot with a divider and makes the next turn start a fresh agent session', async () => {
    const run = liveRun('success')
    db.update(schema.sessions).set({ agentSessionId: 'ses_old', agentHandover: 'old summary' }).where(eq(schema.sessions.id, run.sessionId)).run()
    const res = await post(run.id, { prompt: '/clear' })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ prompt: '/clear', status: 'success' })
    expect(started).not.toContain((res.json as { id: number }).id)
    const items = db.select().from(schema.agentItems).where(eq(schema.agentItems.followupId, (res.json as { id: number }).id)).all()
    expect(items.map(i => i.type)).toEqual(['divider'])
    expect(db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()).toMatchObject({ agentSessionId: null, agentHandover: null })
  })

  it('/clear waits for the running turn', async () => {
    const run = liveRun('success')
    await post(run.id)
    expect((await post(run.id, { prompt: '/clear' })).status).toBe(409)
  })

  it('/pr sends the publish instructions and a model override is kept on the turn', async () => {
    const run = liveRun('success')
    const pr = await post(run.id, { prompt: '/pr', model: 'claude-sonnet-4-5' })
    expect(pr.json).toMatchObject({ prompt: PUBLISH_FOLLOWUP_PROMPT, model: 'claude-sonnet-4-5' })
    expect((await post(run.id, { prompt: 'x', model: 'not a model' })).status).toBe(400)
  })

  it('announces new turns on the session stream and lets a queued one be removed again', async () => {
    const run = liveRun('running')
    const events: LiveEvent[] = []
    const off = onLive(run.sessionId, e => events.push(e))
    const res = await post(run.id)
    const id = (res.json as { id: number }).id
    expect(events).toEqual([{ type: 'followup', sessionId: run.sessionId, followup: expect.objectContaining({ id, status: 'queued' }) }])

    const removed = await callRoute(deleteHandler, { method: 'DELETE', route: '/followups/:id', path: `/followups/${id}` })
    expect(removed.status).toBe(200)
    expect(events.at(-1)).toEqual({ type: 'followup-removed', sessionId: run.sessionId, id })
    expect(db.select().from(schema.followups).where(eq(schema.followups.id, id)).get()).toBeUndefined()
    off()

    db.update(schema.runs).set({ status: 'success' }).where(eq(schema.runs.id, run.id)).run()
    const running = (await post(run.id)).json as { id: number }
    db.update(schema.followups).set({ status: 'running' }).where(eq(schema.followups.id, running.id)).run()
    expect((await callRoute(deleteHandler, { method: 'DELETE', route: '/followups/:id', path: `/followups/${running.id}` })).status).toBe(409)
  })

  it('stores multipart attachments next to the turn and serves them back', async () => {
    const run = liveRun('success')
    const form = new FormData()
    form.set('prompt', 'look at this')
    form.append('files', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    form.append('files', new File(['again'], 'notes.txt', { type: 'text/plain' }))
    const res = await callRoute(handler, { route: '/runs/:id/followups', path: `/runs/${run.id}/followups`, form })
    expect(res.status).toBe(200)
    const created = res.json as { id: number, attachments: { name: string, size: number, type: string }[] }
    expect(created.attachments).toEqual([
      { name: 'notes.txt', size: 5, type: 'text/plain' },
      { name: 'notes-2.txt', size: 5, type: 'text/plain' },
    ])
    const served = await callRoute(attachmentHandler, { method: 'GET', route: '/followups/:id/attachments/:name', path: `/followups/${created.id}/attachments/notes-2.txt` })
    expect(served.status).toBe(200)
    expect(served.text).toBe('again')
    expect((await callRoute(attachmentHandler, { method: 'GET', route: '/followups/:id/attachments/:name', path: `/followups/${created.id}/attachments/other.txt` })).status).toBe(404)
  })

  it('serves only images with their own type, everything else as a download', async () => {
    const run = liveRun('success')
    const form = new FormData()
    form.set('prompt', 'look at this')
    form.append('files', new File(['<script>alert(1)</script>'], 'page.html', { type: 'text/html' }))
    form.append('files', new File(['png'], 'shot.png', { type: 'image/png' }))
    const created = (await callRoute(handler, { route: '/runs/:id/followups', path: `/runs/${run.id}/followups`, form })).json as { id: number }
    const get = (name: string) => callRoute(attachmentHandler, { method: 'GET', route: '/followups/:id/attachments/:name', path: `/followups/${created.id}/attachments/${name}` })

    const html = await get('page.html')
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(html.headers.get('content-disposition')).toBe('attachment; filename="page.html"')
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    const png = await get('shot.png')
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-disposition')).toBeNull()
  })

  it('removing a queued turn removes its attachments from disk', async () => {
    const run = liveRun('running')
    const form = new FormData()
    form.set('prompt', 'later')
    form.append('files', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    const created = (await callRoute(handler, { route: '/runs/:id/followups', path: `/runs/${run.id}/followups`, form })).json as { id: number }
    expect(existsSync(followupAttachmentsDir(created.id))).toBe(true)
    expect((await callRoute(deleteHandler, { method: 'DELETE', route: '/followups/:id', path: `/followups/${created.id}` })).status).toBe(200)
    expect(existsSync(followupAttachmentsDir(created.id))).toBe(false)
  })

  it('retries a failed turn in place: transcript cleared, row queued again, stream told', async () => {
    const run = liveRun('success')
    const failed = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'again', model: 'claude-opus-4-6', status: 'failed', error: 'boom', finishedAt: new Date() }).returning().get()
    db.insert(schema.agentItems).values({ sessionId: run.sessionId, followupId: failed.id, seq: 0, type: 'message', text: 'half an answer' }).run()
    const events: LiveEvent[] = []
    const off = onLive(run.sessionId, e => events.push(e))
    const res = await callRoute(retryHandler, { route: '/followups/:id/retry', path: `/followups/${failed.id}/retry` })
    off()
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ id: failed.id, status: 'queued', error: null, model: 'claude-opus-4-6' })
    expect(db.select().from(schema.agentItems).where(eq(schema.agentItems.followupId, failed.id)).all()).toHaveLength(0)
    expect(events).toEqual([{ type: 'followup-reset', sessionId: run.sessionId, followup: expect.objectContaining({ id: failed.id, status: 'queued' }) }])
    expect(started).toContain(failed.id)

    const running = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'x', status: 'running' }).returning().get()
    expect((await callRoute(retryHandler, { route: '/followups/:id/retry', path: `/followups/${running.id}/retry` })).status).toBe(409)
  })

  it('serves the whole session as one transcript: its runs and every turn with items', async () => {
    const project = makeProject()
    const first = makeRun(project, [], { status: 'success' })
    const second = makeRun(project, [], { status: 'success', sessionId: first.sessionId })
    db.update(schema.sessions).set({ envState: 'up' }).where(eq(schema.sessions.id, first.sessionId)).run()
    await post(first.id, { prompt: 'one' })
    await post(second.id, { prompt: 'two' })
    const res = await callRoute(transcriptHandler, { method: 'GET', route: '/sessions/:id/transcript', path: `/sessions/${first.sessionId}/transcript` })
    expect(res.status).toBe(200)
    const body = res.json as { runs: { id: number }[], followups: { prompt: string, runId: number, items: unknown[] }[] }
    expect(body.runs.map(r => r.id)).toEqual([first.id, second.id])
    expect(body.followups.map(f => [f.prompt, f.runId])).toEqual([['one', first.id], ['two', second.id]])
    expect(body.followups[0]!.items).toEqual([])
  })
})
