import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWorkflow } from '../../server/workflows/schema'

describe('examples/', () => {
  const dir = join(import.meta.dirname, '../../examples')
  for (const file of readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
    it(`${file} parses as a workflow document`, () => {
      const workflow = parseWorkflow(readFileSync(join(dir, file), 'utf8'))
      expect(workflow.name.length).toBeGreaterThan(0)
      expect(workflow.steps.length).toBeGreaterThan(0)
    })
  }
})
