import { describe, expect, it } from 'vitest'
import type { Step } from '../../shared/utils/workflow'
import { buildStatusMap, type RunStepRowLike } from '../../app/utils/step-status'

// Fixture: bash(a) → if(cond) { then: [bash(b), bash(c)], else: [bash(d)] } → bash(e)
function ifTree(): Step[] {
  return [
    { type: 'bash', command: 'a', id: 'a' },
    {
      type: 'if',
      id: 'cond',
      conditions: [],
      then: [
        { type: 'bash', command: 'b', id: 'b' },
        { type: 'bash', command: 'c', id: 'c' },
      ],
      else: [{ type: 'bash', command: 'd', id: 'd' }],
    },
    { type: 'bash', command: 'e', id: 'e' },
  ]
}

// Fixture: loop(lp) { steps: [bash(child)] } → bash(after)
function loopTree(): Step[] {
  return [
    { type: 'loop', id: 'lp', items: '3', steps: [{ type: 'bash', command: 'x', id: 'child' }] },
    { type: 'bash', command: 'y', id: 'after' },
  ]
}

function row(stepId: string, status: RunStepRowLike['status']): RunStepRowLike {
  return { stepId, status }
}

function statusOf(map: Map<string, { status: string }>, id: string) {
  return map.get(id)?.status
}

describe('buildStatusMap', () => {
  it('returns an empty map without an active run', () => {
    expect(buildStatusMap(ifTree(), null, []).size).toBe(0)
  })

  it('maps rows to done/running/error and row-less top-level steps to pending', () => {
    const map = buildStatusMap(ifTree(), { status: 'running' }, [
      row('a', 'success'),
      row('cond', 'running'),
    ])
    expect(statusOf(map, 'a')).toBe('done')
    expect(statusOf(map, 'cond')).toBe('running')
    expect(statusOf(map, 'e')).toBe('pending')
  })

  it('marks row-less top-level steps skipped once the run failed', () => {
    const map = buildStatusMap(ifTree(), { status: 'failed' }, [row('a', 'failed')])
    expect(statusOf(map, 'a')).toBe('error')
    expect(statusOf(map, 'cond')).toBe('skipped')
    expect(statusOf(map, 'e')).toBe('skipped')
  })

  it('skips the not-taken branch as soon as the other branch has rows', () => {
    const map = buildStatusMap(ifTree(), { status: 'running' }, [
      row('a', 'success'),
      row('cond', 'running'),
      row('b', 'running'),
    ])
    expect(statusOf(map, 'b')).toBe('running')
    expect(statusOf(map, 'c')).toBe('pending') // taken branch, not reached yet
    expect(statusOf(map, 'd')).toBe('skipped') // other branch ran
  })

  it('keeps both branches pending while the if itself is still running undecided', () => {
    const map = buildStatusMap(ifTree(), { status: 'running' }, [
      row('a', 'success'),
      row('cond', 'running'),
    ])
    expect(statusOf(map, 'b')).toBe('pending')
    expect(statusOf(map, 'd')).toBe('pending')
  })

  it('skips both branches of a finished if with an empty taken branch', () => {
    const map = buildStatusMap(ifTree(), { status: 'running' }, [
      row('a', 'success'),
      row('cond', 'success'),
      row('e', 'running'),
    ])
    expect(statusOf(map, 'b')).toBe('skipped')
    expect(statusOf(map, 'd')).toBe('skipped')
  })

  it('aggregates loop iterations: running wins, then failed, and counts runs', () => {
    const running = buildStatusMap(loopTree(), { status: 'running' }, [
      row('lp', 'running'),
      row('child', 'failed'),
      row('child', 'success'),
      row('child', 'running'),
    ])
    expect(running.get('child')).toEqual({ status: 'running', runs: 3 })

    const failed = buildStatusMap(loopTree(), { status: 'failed' }, [
      row('lp', 'failed'),
      row('child', 'success'),
      row('child', 'failed'),
    ])
    expect(failed.get('child')).toEqual({ status: 'error', runs: 2 })
  })

  it('skips a loop body that never ran and keeps it pending while the loop runs', () => {
    const zeroIterations = buildStatusMap(loopTree(), { status: 'running' }, [
      row('lp', 'success'),
      row('after', 'running'),
    ])
    expect(statusOf(zeroIterations, 'child')).toBe('skipped')
    expect(zeroIterations.get('child')?.runs).toBeUndefined()

    const stillRunning = buildStatusMap(loopTree(), { status: 'running' }, [row('lp', 'running')])
    expect(statusOf(stillRunning, 'child')).toBe('pending')
  })

  it('cascades skipped through nested composites', () => {
    const steps: Step[] = [
      {
        type: 'if',
        id: 'outer',
        conditions: [],
        then: [{ type: 'loop', id: 'lp', items: '2', steps: [{ type: 'bash', command: 'x', id: 'deep' }] }],
        else: [],
      },
    ]
    const map = buildStatusMap(steps, { status: 'running' }, [row('outer', 'success')])
    expect(statusOf(map, 'lp')).toBe('skipped')
    expect(statusOf(map, 'deep')).toBe('skipped')
  })
})
