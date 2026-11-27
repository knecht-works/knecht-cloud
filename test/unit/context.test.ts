import { describe, expect, it } from 'vitest'
import { createContext, evalConditions, render, renderStepParams, resolveLoopItems, type RunContext } from '#server/workflows/context'
import type { Step } from '#shared/utils/workflow'
import type { Project } from '#server/db/schema'

function ctx(extra: Record<string, unknown> = {}): RunContext {
  return {
    run: { id: 7, url: 'http://knecht.test/runs/7' },
    project: { name: 'demo', owner: 'acme', fullName: 'acme/demo', defaultBranch: 'main' },
    inputs: { mode: 'fast', labels: ['qa-sonder-alt', 'bug'], one: ['bug'], none: [] },
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

  it('renders a list input as comma-separated text, as before labels became a list', () => {
    expect(render('labels: {{ inputs.labels }}', ctx())).toBe('labels: qa-sonder-alt, bug')
  })
})

describe('createContext', () => {
  it('reads the labels of a run stored before they became a list', () => {
    const project = { name: 'demo', owner: 'acme', fullName: 'acme/demo', defaultBranch: 'main' } as Project
    expect(createContext(1, project, { labels: 'bug, ui', title: 't' }).inputs).toEqual({ labels: ['bug', 'ui'], title: 't' })
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
    const mixed = renderStepParams({ ...step, input: 'x{{ steps.probe.json }}' }, ctx(), ['input'])
    expect(mixed.input).toBe('x{"score":3,"tags":["a","b"]}')
  })

  it('hands a list input to a raw param as comma-separated text', () => {
    const step: Step = { type: 'js', id: 'x', code: 'main', input: '{{ inputs.labels }}' }
    expect(renderStepParams(step, ctx(), ['input']).input).toBe('qa-sonder-alt, bug')
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
    ['contains on a list matches whole items', [[{ left: '{{ inputs.labels }}', op: 'contains', right: 'bug' }]], true],
    ['contains on a list is no substring match', [[{ left: '{{ inputs.labels }}', op: 'contains', right: 'qa-sonder' }]], false],
    ['not-contains on a list', [[{ left: '{{ inputs.labels }}', op: 'not-contains', right: 'qa-sonder' }]], true],
    ['eq on a list compares its text', [[{ left: '{{ inputs.one }}', op: 'eq', right: 'bug' }]], true],
    ['regex on a list matches its text', [[{ left: '{{ inputs.labels }}', op: 'regex', right: '^qa-sonder-alt, bug$' }]], true],
    ['empty on an empty list', [[{ left: '{{ inputs.none }}', op: 'empty' }]], true],
    ['not-empty on an empty list', [[{ left: '{{ inputs.none }}', op: 'not-empty' }]], false],
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
    expect(resolveLoopItems('{{ inputs.labels }}', ctx())).toEqual(['qa-sonder-alt', 'bug'])
  })

  it('rejects values that are neither an array nor a non-negative number', () => {
    expect(() => resolveLoopItems('nonsense', ctx())).toThrow(/array or a non-negative number/)
    expect(() => resolveLoopItems('-2', ctx())).toThrow(/array or a non-negative number/)
  })

  it('rejects runaway iteration counts', () => {
    expect(() => resolveLoopItems('1001', ctx())).toThrow(/max 1000/)
  })
})
