import { describe, expect, it } from 'vitest'
import {
  ensureStepIds,
  isDerivedStepId,
  parseAiOutputSpec,
  renameStepReferences,
  slugifyStepId,
  stepTreeDepth,
  type Step,
} from '../../shared/utils/workflow'

describe('ensureStepIds', () => {
  it('backfills ids from labels (or the type) and de-duplicates collisions', () => {
    const steps = ensureStepIds([
      { type: 'bash', command: 'a', label: 'Run Lighthouse' },
      { type: 'bash', command: 'b' },
      { type: 'bash', command: 'c' },
    ])
    expect(steps.map(s => s.id)).toEqual(['run_lighthouse', 'bash', 'bash_2'])
  })

  it('recurses into composite steps with one flat id namespace', () => {
    const steps = ensureStepIds([
      { type: 'bash', command: 'a' },
      {
        type: 'if',
        conditions: [],
        then: [{ type: 'bash', command: 'b' }],
        else: [{ type: 'loop', items: '2', steps: [{ type: 'bash', command: 'c' }] }],
      },
    ] as Step[])
    const inner = steps[1] as Extract<Step, { type: 'if' }>
    const loop = inner.else[0] as Extract<Step, { type: 'loop' }>
    expect(steps[0]!.id).toBe('bash')
    expect(inner.then[0]!.id).toBe('bash_2')
    expect(loop.steps[0]!.id).toBe('bash_3')
  })

  it('returns a fully-idd tree untouched and keeps valid ids on partial backfill', () => {
    const complete: Step[] = [{ type: 'bash', id: 'mine', command: 'a' }]
    expect(ensureStepIds(complete)).toBe(complete)
    const partial = ensureStepIds([
      { type: 'bash', id: 'mine', command: 'a' },
      { type: 'bash', command: 'b' },
    ])
    expect(partial.map(s => s.id)).toEqual(['mine', 'bash'])
  })
})

describe('slugifyStepId / isDerivedStepId', () => {
  it('slugs GitHub-Actions style, handling accents, digits and empty results', () => {
    expect(slugifyStepId('Run Lighthouse')).toBe('run_lighthouse')
    expect(slugifyStepId('Prüfe Übersicht')).toBe('prufe_ubersicht')
    expect(slugifyStepId('3rd check')).toBe('s_3rd_check')
    expect(slugifyStepId('🎉')).toBe('')
  })

  it('recognizes derived ids including collision suffixes', () => {
    expect(isDerivedStepId('run_lighthouse', 'Run Lighthouse')).toBe(true)
    expect(isDerivedStepId('run_lighthouse_2', 'Run Lighthouse')).toBe(true)
    expect(isDerivedStepId('my_custom_id', 'Run Lighthouse')).toBe(false)
  })
})

describe('renameStepReferences', () => {
  it('rewrites references in params, if conditions and composite bodies', () => {
    const steps: Step[] = [
      { type: 'bash', id: 'old', command: 'echo x' },
      {
        type: 'if',
        id: 'gate',
        conditions: [[{ left: '{{ steps.old.stdout }}', op: 'eq', right: '{{steps.old.exitCode}}' }]],
        then: [{ type: 'bash', id: 'inner', command: 'echo {{ steps.old.stdout }}' }],
        else: [],
      },
      // A different id sharing the prefix must NOT be rewritten.
      { type: 'bash', id: 'tail', command: 'echo {{ steps.older.stdout }}' },
    ]
    renameStepReferences(steps, 'old', 'fresh')
    const gate = steps[1] as Extract<Step, { type: 'if' }>
    expect(gate.conditions[0]![0]!.left).toBe('{{ steps.fresh.stdout }}')
    expect(gate.conditions[0]![0]!.right).toBe('{{steps.fresh.exitCode}}')
    expect((gate.then[0] as Extract<Step, { type: 'bash' }>).command).toBe('echo {{ steps.fresh.stdout }}')
    expect((steps[2] as Extract<Step, { type: 'bash' }>).command).toBe('echo {{ steps.older.stdout }}')
  })
})

describe('stepTreeDepth', () => {
  it('counts nesting through composite children', () => {
    expect(stepTreeDepth([{ type: 'bash', id: 'a', command: 'x' }])).toBe(1)
    expect(stepTreeDepth([
      {
        type: 'loop',
        items: '2',
        steps: [{ type: 'if', conditions: [], then: [{ type: 'bash', command: 'x' }], else: [] }],
      },
    ] as Step[])).toBe(3)
  })
})

describe('parseAiOutputSpec', () => {
  it('parses name: type lines, skipping blanks', () => {
    expect(parseAiOutputSpec('summary: string\n\nscore: number\nflags: boolean[]')).toEqual([
      { name: 'summary', type: 'string' },
      { name: 'score', type: 'number' },
      { name: 'flags', type: 'boolean[]' },
    ])
  })

  it('throws on malformed lines and on an empty spec', () => {
    expect(() => parseAiOutputSpec('summary')).toThrow(/expected 'name: type'/)
    expect(() => parseAiOutputSpec('summary: text')).toThrow(/Invalid type 'text'/)
    expect(() => parseAiOutputSpec('bad name: string')).toThrow(/Invalid output field name/)
    expect(() => parseAiOutputSpec('\n  \n')).toThrow(/no fields/)
  })
})
