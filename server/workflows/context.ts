import type { Project } from '../db/schema'
import { STEP_META_KEYS, type Condition, type Step } from '../../shared/utils/workflow'
import { tryParseJson } from '../utils/json'

// The run-scoped variable namespace (workflows.md §6): a single object seeded
// at run start, into which each block's outputs land as it runs, so values
// flow front to back through the linear sequence and any block can read
// everything produced before it. Block params are `render()`ed against this
// just before the block runs.
//
// Outputs live under `steps.<id>` (collision-free: two create-branch steps
// don't overwrite each other). The runner ALSO writes each action's legacy
// top-level key (`branch`, `pr`, `preview`, `commit`) so templates written
// before step ids existed keep rendering; the legacy key holds the LAST such
// step's outputs, exactly as before.
export interface RunContext {
  run: { id: number }
  project: { name: string, owner: string, fullName: string, defaultBranch: string }
  inputs: Record<string, string>
  steps: Record<string, Record<string, unknown>>
  // Legacy top-level output keys land here as the run proceeds.
  [output: string]: unknown
}

export function createContext(
  runId: number,
  project: Project,
  inputs: Record<string, string> = {},
): RunContext {
  return {
    run: { id: runId },
    project: {
      name: project.name,
      owner: project.owner,
      fullName: project.fullName,
      defaultBranch: project.defaultBranch,
    },
    inputs,
    steps: {},
  }
}

// Substitute `{{ path.to.value }}` references against the context. Dotted paths
// walk nested objects; an unknown path resolves to '': templating is
// best-effort, so an optional value a block hasn't produced yet (e.g.
// `{{ preview.url }}` before ddev-start) just renders empty rather than failing.
// Objects/arrays render as JSON (a step's whole output bag is referenceable).
export function render(template: string, ctx: RunContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = lookup(path, ctx)
    if (value == null) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

function lookup(path: string, ctx: RunContext): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    ctx,
  )
}

// Step meta never reaches execution. Don't render it.
const META_KEYS = new Set<string>(STEP_META_KEYS)

// A template that is exactly one reference, eligible for raw-value resolution.
const SINGLE_REF_RE = /^\{\{\s*([\w.]+)\s*\}\}$/

// Render every templated string param of a step against the context, just
// before the step runs. Non-string params (booleans, nested shapes) pass
// through untouched. Params listed in `rawParams` (ActionDef) whose template is
// exactly one `{{ ref }}` resolve to the referenced RAW value instead of a
// string. Structured data flows between steps without a stringify round-trip.
export function renderStepParams<S extends Step>(step: S, ctx: RunContext, rawParams: readonly string[] = []): S {
  const rendered = { ...step } as Record<string, unknown>
  for (const [key, value] of Object.entries(rendered)) {
    if (typeof value !== 'string' || META_KEYS.has(key)) continue
    const single = rawParams.includes(key) ? value.trim().match(SINGLE_REF_RE) : null
    rendered[key] = single ? lookup(single[1]!, ctx) : render(value, ctx)
  }
  return rendered as S
}

// Evaluate an if step's conditions: outer array = OR groups, inner = AND. Both
// sides render against the context; operators compare the rendered strings
// (gt/lt coerce to numbers). An empty conditions list matches.
export function evalConditions(groups: Condition[][], ctx: RunContext): boolean {
  if (!groups.length) return true
  return groups.some(group => group.length > 0 && group.every(c => evalCondition(c, ctx)))
}

function evalCondition(c: Condition, ctx: RunContext): boolean {
  const left = render(c.left, ctx)
  const right = render(c.right ?? '', ctx)
  switch (c.op) {
    case 'eq': return left === right
    case 'neq': return left !== right
    case 'contains': return left.includes(right)
    case 'not-contains': return !left.includes(right)
    case 'empty': return left.trim() === ''
    case 'not-empty': return left.trim() !== ''
    case 'gt': return Number(left) > Number(right)
    case 'lt': return Number(left) < Number(right)
    case 'regex':
      try {
        return new RegExp(right).test(left)
      }
      catch {
        return false
      }
  }
}

// A loop iterates at most this many times: the runaway guard.
const MAX_LOOP_ITERATIONS = 1000

// Resolve a loop's `items` template to the values to iterate: an array (a
// single {{ ref }} passes it raw; a JSON-array string parses) or a number N
// (repeat N times, iterating 0..N-1).
export function resolveLoopItems(items: string, ctx: RunContext): unknown[] {
  const single = items.trim().match(SINGLE_REF_RE)
  let value: unknown = single ? lookup(single[1]!, ctx) : render(items, ctx)
  if (typeof value === 'string') {
    const text = value.trim()
    value = /^\d+$/.test(text) ? Number(text) : tryParseJson(text) ?? value
  }
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'number' && Number.isInteger(value) && value >= 0)
        ? Array.from({ length: value }, (_, i) => i)
        : null
  if (!list) throw new Error(`loop items must resolve to an array or a non-negative number (got: ${JSON.stringify(value)?.slice(0, 120) ?? typeof value})`)
  if (list.length > MAX_LOOP_ITERATIONS) throw new Error(`loop would run ${list.length} iterations (max ${MAX_LOOP_ITERATIONS})`)
  return list
}
