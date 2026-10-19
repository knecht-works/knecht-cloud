import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { desc } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { deleteToolCallsBefore } from '../../server/stores/tool-calls'
import { callTool, defineTool, ToolDeniedError, type ToolContext } from '../../server/tools/registry'

const member: ToolContext = { actor: { kind: 'member', login: 'octo' }, channel: 'dashboard' }
const system: ToolContext = { actor: { kind: 'system' }, channel: 'daemon' }

function lastCall() {
  return db.select().from(schema.toolCalls).orderBy(desc(schema.toolCalls.id)).get()!
}

const writeTool = defineTool({
  name: 'test_write',
  description: '',
  scope: 'tests:write',
  input: z.object({ n: z.number() }),
  run: ({ n }) => n * 2,
})

describe('tool registry', () => {
  beforeEach(() => {
    db.delete(schema.toolCalls).run()
  })

  it('runs a tool for a member and audits the call', async () => {
    expect(await callTool(writeTool, { n: 2 }, member)).toBe(4)
    expect(lastCall()).toMatchObject({ actor: 'octo', channel: 'dashboard', tool: 'test_write', input: { n: 2 }, error: null })
  })

  it('refuses writes by the system and audits the refusal', async () => {
    await expect(callTool(writeTool, { n: 2 }, system)).rejects.toBeInstanceOf(ToolDeniedError)
    expect(lastCall()).toMatchObject({ actor: null, channel: 'daemon', error: expect.stringContaining('writes') })
  })

  it('audits input that fails validation', async () => {
    await expect(callTool(writeTool, { n: 'x' } as never, member)).rejects.toThrow()
    expect(lastCall().error).toBeTruthy()
  })

  it('deletes audit records older than the cutoff', async () => {
    await callTool(writeTool, { n: 1 }, member)
    expect(deleteToolCallsBefore(new Date(Date.now() - 60_000))).toBe(0)
    expect(deleteToolCallsBefore(new Date(Date.now() + 60_000))).toBe(1)
  })
})
