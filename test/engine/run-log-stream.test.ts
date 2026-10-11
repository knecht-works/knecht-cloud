import { describe, expect, it } from 'vitest'
import { onRunLog, type RunLogChunk } from '../../server/utils/live'
import { appendRunLog, readRunLog } from '../../server/stores/runs'
import { makeProject, makeRun } from '../helpers/db'

describe('run log stream', () => {
  it('announces each append with its byte offset', () => {
    const run = makeRun(makeProject(), [])
    const chunks: RunLogChunk[] = []
    const off = onRunLog(run.id, c => chunks.push(c))
    appendRunLog(run.id, 'größe\n')
    appendRunLog(run.id, 'ok\n')
    off()
    expect(chunks).toEqual([{ text: 'größe\n', end: 8 }, { text: 'ok\n', end: 11 }])
  })

  it('resumes from a byte offset without losing or repeating text', () => {
    const run = makeRun(makeProject(), [])
    appendRunLog(run.id, 'größe\n')
    appendRunLog(run.id, 'ok\n')
    expect(readRunLog(run.id, 0)).toEqual({ text: 'größe\nok\n', end: 11 })
    expect(readRunLog(run.id, 8)).toEqual({ text: 'ok\n', end: 11 })
    expect(readRunLog(run.id, 11)).toEqual({ text: '', end: 11 })
  })
})
