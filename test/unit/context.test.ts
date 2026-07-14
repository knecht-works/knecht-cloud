import { describe, expect, it } from 'vitest'
import { evalConditions, render, renderStepParams, resolveLoopItems, type RunContext } from '../../server/workflows/context'
import type { Step } from '../../shared/utils/workflow'

function ctx(extra: Record<string, unknown> = {}): RunContext {
  return {
    run: { id: 7, url: 'http://knecht.test/runs/7' },
    project: { name: 'demo', owner: 'acme', fullName: 'acme/demo', defaultBranch: 'main' },
    inputs: { mode: 'fast' },
    steps: { probe: { stdout: 'hello', exitCode: 0, json: { score: 3, tags: ['a', 'b'] } } },
    ...extra,
  }
}

describe('render', () => {
  it('substitutes dotted paths and leaves unknown paths empty', () => {
    expect(render('run {{ run.id }} on {{ project.name }}', ctx())).toBe('run 7 on demo')
    expect(render('missing [{{ steps.nope.value }}]', ctx())).toBe('missing []')
  })

  it('renders objects and arrays as JSON', () => {
    expect(render('{{ steps.probe.json }}', ctx())).toBe('{"score":3,"tags":["a","b"]}')
    expect(render('{{ steps.probe.json.tags }}', ctx())).toBe('["a","b"]')
  })
})

describe('renderStepParams', () => {
  it('renders string params but never step meta', () => {
    const step: Step = { type: 'bash', id: 'x', label: 'say {{ run.id }}', command: 'echo {{ inputs.mode }}' }
    const rendered = renderStepParams(step, ctx())
    expect(rendered.command).toBe('echo fast')
    expect(rendered.label).toBe('say {{ run.id }}')
  })

  it('resolves a raw param that is exactly one reference to the raw value', () => {
    const step: Step = { type: 'js', id: 'x', code: 'main', input: '{{ steps.probe.json }}' }
    const rendered = renderStepParams(step, ctx(), ['input'])
    expect(rendered.input).toEqual({ score: 3, tags: ['a', 'b'] })
    // Anything beyond the single reference falls back to string rendering.
    const mixed = renderStepParams({ ...step, input: 'x{{ steps.probe.json }}' }, ctx(), ['input'])
    expect(mixed.input).toBe('x{"score":3,"tags":["a","b"]}')
  })
})

describe('evalConditions', () => {
  const cases: [string, Parameters<typeof evalConditions>[0], boolean][] = [
    ['eq', [[{ left: '{{ inputs.mode }}', op: 'eq', right: 'fast' }]], true],
    ['neq', [[{ left: '{{ inputs.mode }}', op: 'neq', right: 'fast' }]], false],
    ['contains', [[{ left: '{{ steps.probe.stdout }}', op: 'contains', right: 'ell' }]], true],
    ['not-contains', [[{ left: '{{ steps.probe.stdout }}', op: 'not-contains', right: 'ell' }]], false],
    ['empty on unknown path', [[{ left: '{{ steps.nope.out }}', op: 'empty' }]], true],
    ['not-empty', [[{ left: '{{ steps.probe.stdout }}', op: 'not-empty' }]], true],
    ['gt coerces numbers', [[{ left: '{{ steps.probe.json.score }}', op: 'gt', right: '2' }]], true],
    ['lt', [[{ left: '{{ steps.probe.json.score }}', op: 'lt', right: '2' }]], false],
    ['regex', [[{ left: '{{ steps.probe.stdout }}', op: 'regex', right: '^hel+o$' }]], true],
    ['invalid regex is false, not an error', [[{ left: 'x', op: 'regex', right: '(' }]], false],
    ['AND within a group', [[{ left: '1', op: 'eq', right: '1' }, { left: '1', op: 'eq', right: '2' }]], false],
    ['OR across groups', [[{ left: '1', op: 'eq', right: '2' }], [{ left: '1', op: 'eq', right: '1' }]], true],
    ['no conditions match everything', [], true],
    ['an empty group matches nothing', [[]], false],
  ]
  it.each(cases)('%s', (_name, groups, expected) => {
    expect(evalConditions(groups, ctx())).toBe(expected)
  })
})

describe('resolveLoopItems', () => {
  it('repeats N times for a number', () => {
    expect(resolveLoopItems('3', ctx())).toEqual([0, 1, 2])
    expect(resolveLoopItems('0', ctx())).toEqual([])
  })

  it('passes a single-reference array raw and parses a JSON array string', () => {
    expect(resolveLoopItems('{{ steps.probe.json.tags }}', ctx())).toEqual(['a', 'b'])
    expect(resolveLoopItems('["x", 1]', ctx())).toEqual(['x', 1])
  })

  it('rejects values that are neither an array nor a non-negative number', () => {
    expect(() => resolveLoopItems('nonsense', ctx())).toThrow(/array or a non-negative number/)
    expect(() => resolveLoopItems('-2', ctx())).toThrow(/array or a non-negative number/)
  })

  it('rejects runaway iteration counts', () => {
    expect(() => resolveLoopItems('1001', ctx())).toThrow(/max 1000/)
  })
})
