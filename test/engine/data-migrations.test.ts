import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { runDataMigrations } from '../../server/db/data-migrations'
import type { Step } from '../../shared/utils/workflow'

// The JS data migrations against the real schema (the engine setup runs the
// SQL migrations but not runDataMigrations, so this is where they execute).
// Focus: 0002_bare_ai_step_models strips legacy provider prefixes from ai-step
// model overrides, including nested steps, and records its bookkeeping row.

function makeWorkflow(name: string, steps: Step[]) {
  db.insert(schema.workflows).values({ name, steps }).run()
}

function getSteps(name: string): Step[] {
  return db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()!.steps
}

describe('runDataMigrations', () => {
  it('strips known provider prefixes from ai-step models, also in nested steps', () => {
    makeWorkflow('legacy', [
      { id: 'one', type: 'ai', prompt: 'p', model: 'anthropic/claude-sonnet-4-5' },
      {
        id: 'guard',
        type: 'if',
        conditions: [],
        then: [{ id: 'two', type: 'ai', prompt: 'p', model: 'opencode/kimi-k2' }],
        else: [],
      } as unknown as Step,
    ])
    makeWorkflow('modern', [
      { id: 'bare', type: 'ai', prompt: 'p', model: 'claude-sonnet-4-5' },
      { id: 'slashed', type: 'ai', prompt: 'p', model: 'meta-llama/llama-3.3-70b' },
      { id: 'none', type: 'ai', prompt: 'p' },
    ])

    runDataMigrations()

    const legacy = getSteps('legacy')
    expect(legacy[0]).toMatchObject({ model: 'claude-sonnet-4-5' })
    expect((legacy[1] as Extract<Step, { type: 'if' }>).then[0]).toMatchObject({ model: 'kimi-k2' })
    const modern = getSteps('modern')
    expect(modern[0]).toMatchObject({ model: 'claude-sonnet-4-5' })
    expect(modern[1]).toMatchObject({ model: 'meta-llama/llama-3.3-70b' })
    expect(modern[2]).not.toHaveProperty('model')

    const applied = db.select().from(schema.dataMigrations).all().map(r => r.name)
    expect(applied).toContain('0002_bare_ai_step_models')
  })

  it('is a no-op on the second run', () => {
    const before = getSteps('legacy')
    runDataMigrations()
    expect(getSteps('legacy')).toEqual(before)
  })
})
