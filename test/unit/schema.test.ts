import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWorkflow, serializeWorkflow, workflowDocumentSchema } from '../../server/workflows/schema'
import type { Step } from '../../shared/utils/workflow'

const KITCHEN_SINK = readFileSync(new URL('../fixtures/workflows/kitchen-sink.yaml', import.meta.url), 'utf8')

describe('parseWorkflow (YAML authoring sugar)', () => {
  const steps = parseWorkflow(KITCHEN_SINK).steps

  it('normalizes the bare literal and the params form of ddev-start', () => {
    expect(steps[0]).toMatchObject({ type: 'ddev-start' })
    expect(steps[1]).toMatchObject({ type: 'ddev-start', commands: expect.stringContaining('composer install') })
  })

  it('maps bash continue-on-error onto the step error policy', () => {
    expect(steps[2]).toMatchObject({ type: 'bash', command: 'echo hello', continueOnError: true })
  })

  it('maps create-pr description onto body', () => {
    expect(steps.at(-1)).toMatchObject({ type: 'create-pr', title: 'Fix broken links', body: expect.stringContaining('run {{ run.id }}') })
  })

  it('normalizes a flat condition list into one OR group and backfills ids', () => {
    const gate = steps.find(s => s.type === 'if') as Extract<Step, { type: 'if' }>
    expect(gate.conditions).toEqual([[{ left: '{{ steps.link_check.broken }}', op: 'gt', right: '0' }]])
    // Every step in the tree got an id, including the nested loop body.
    const loop = gate.then[0] as Extract<Step, { type: 'loop' }>
    expect(loop.id).toBeTruthy()
    expect(loop.steps[0]!.id).toBeTruthy()
  })
})

describe('export/import roundtrip', () => {
  it('is the identity for YAML and JSON over the fixture corpus', () => {
    const wf = parseWorkflow(KITCHEN_SINK)
    for (const format of ['yaml', 'json'] as const) {
      expect(parseWorkflow(serializeWorkflow(wf, format))).toEqual(wf)
    }
  })
})

describe('workflowDocumentSchema guards', () => {
  it('rejects a newer format version with a clear message', () => {
    const result = workflowDocumentSchema.safeParse({ version: 99, name: 'x', steps: [{ type: 'bash', command: 'a' }] })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('newer workflow format')
  })

  it('rejects names that would break URLs and runs references', () => {
    const result = workflowDocumentSchema.safeParse({ name: 'a/b', steps: [{ type: 'bash', command: 'a' }] })
    expect(result.success).toBe(false)
  })

  it('rejects steps nested deeper than the cap', () => {
    const nest = (inner: object): object => ({ type: 'if', conditions: [], then: [inner], else: [] })
    const tooDeep = nest(nest(nest({ type: 'bash', command: 'a' })))
    const result = workflowDocumentSchema.safeParse({ name: 'deep', steps: [tooDeep] })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('nest deeper')
  })
})
