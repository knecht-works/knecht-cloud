import type { Project } from '../db/schema'
import type { Step } from '../../shared/utils/workflow'

// The run-scoped variable namespace (workflows.md §6): a single object seeded
// at run start, into which each block's outputs land as it runs — so values
// flow front to back through the linear sequence and any block can read
// everything produced before it. Block params are `render()`ed against this
// just before the block runs.
//
// Outputs live under `steps.<id>` (collision-free — two create-branch steps
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
// walk nested objects; an unknown path resolves to '' — templating is
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

// Step meta never reaches execution — don't render it.
const META_KEYS = new Set(['type', 'label', 'description'])

// A template that is exactly one reference — eligible for raw-value resolution.
const SINGLE_REF_RE = /^\{\{\s*([\w.]+)\s*\}\}$/

// Render every templated string param of a step against the context, just
// before the step runs. Non-string params (booleans, nested shapes) pass
// through untouched. Params listed in `rawParams` (ActionDef) whose template is
// exactly one `{{ ref }}` resolve to the referenced RAW value instead of a
// string — structured data flows between steps without a stringify round-trip.
export function renderStepParams<S extends Step>(step: S, ctx: RunContext, rawParams: readonly string[] = []): S {
  const rendered = { ...step } as Record<string, unknown>
  for (const [key, value] of Object.entries(rendered)) {
    if (typeof value !== 'string' || META_KEYS.has(key)) continue
    const single = rawParams.includes(key) ? value.trim().match(SINGLE_REF_RE) : null
    rendered[key] = single ? lookup(single[1]!, ctx) : render(value, ctx)
  }
  return rendered as S
}
