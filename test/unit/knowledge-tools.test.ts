import { describe, expect, it, vi } from 'vitest'

vi.mock('../../CONTEXT.md', () => ({ default: '# Knecht' }))

const { describeWorkflowFormatTool, glossaryTool } = await import('../../server/tools/knowledge')

describe('knowledge tools', () => {
  it('describes every step type of a workflow document', async () => {
    const schema = JSON.stringify(await describeWorkflowFormatTool.run({}, { actor: { kind: 'system' }, channel: 'daemon' }))
    for (const type of ['bash', 'ai', 'http', 'if', 'loop']) expect(schema).toContain(`"const":"${type}"`)
  })

  it('returns the glossary', async () => {
    expect(await glossaryTool.run({}, { actor: { kind: 'system' }, channel: 'daemon' })).toBe('# Knecht')
  })
})
