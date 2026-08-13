import { describe, expect, it } from 'vitest'
import { draftStepsSchema, publishStepsSchema, workflowPatchSchema } from '../../server/workflows/schema'

// The draft/publish split: drafts autosave with only structure enforced,
// publishing (and a draft test run) runs the strict schema.

describe('draftStepsSchema (loose editor drafts)', () => {
  it('accepts half-filled steps and returns them untouched', () => {
    const draft = [{ type: 'bash' }, { type: 'ai', label: 'fill in later' }]
    const result = draftStepsSchema.safeParse(draft)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(draft)
  })

  it('passes unknown keys through byte-identical (the client diffs against the stored draft)', () => {
    const draft = [{ type: 'http', url: '', headers: { 'x-later': 'maybe' }, retry: { attempts: 3 } }]
    expect(draftStepsSchema.parse(draft)).toEqual(draft)
  })

  it('rejects an unknown step type', () => {
    expect(draftStepsSchema.safeParse([{ type: 'teleport' }]).success).toBe(false)
  })

  it('enforces the depth cap through composite children', () => {
    const nest = (inner: object): object => ({ type: 'if', conditions: [], then: [inner] })
    const tooDeep = [nest(nest(nest({ type: 'bash' })))]
    const result = draftStepsSchema.safeParse(tooDeep)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('nest deeper')
  })

  it('allows an empty draft (a brand-new workflow)', () => {
    expect(draftStepsSchema.safeParse([]).success).toBe(true)
  })
})

describe('publishStepsSchema (the strict publish gate)', () => {
  it('rejects an empty workflow', () => {
    const result = publishStepsSchema.safeParse([])
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('at least one step')
  })

  it('rejects a step missing its required params', () => {
    expect(publishStepsSchema.safeParse([{ type: 'bash' }]).success).toBe(false)
  })

  it('accepts a complete draft and backfills step ids', () => {
    const result = publishStepsSchema.parse([{ type: 'bash', command: 'echo hi' }])
    expect(result[0]).toMatchObject({ type: 'bash', command: 'echo hi' })
    expect(result[0]!.id).toBeTruthy()
  })
})

describe('workflowPatchSchema (partial autosave bodies)', () => {
  it('accepts each field on its own', () => {
    expect(workflowPatchSchema.safeParse({ enabled: false }).success).toBe(true)
    expect(workflowPatchSchema.safeParse({ description: '' }).success).toBe(true)
    expect(workflowPatchSchema.safeParse({ draftSteps: [{ type: 'bash' }] }).success).toBe(true)
  })

  it('rejects an invalid name', () => {
    expect(workflowPatchSchema.safeParse({ name: 'a/b' }).success).toBe(false)
    expect(workflowPatchSchema.safeParse({ name: '' }).success).toBe(false)
  })
})
