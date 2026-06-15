import type { Project } from '../db/schema'

// The run-scoped variable namespace (workflows.md §6). This is the n8n/Buddy
// model: a single object seeded at run start, into which each block writes its
// outputs (`branch`, `commit`, `pr`, …) as it runs — so values flow front to
// back through the linear sequence and any block can read everything produced
// before it. Block params are `render()`ed against this just before the block
// runs.
export interface RunContext {
  run: { id: number }
  project: { name: string, owner: string, fullName: string, defaultBranch: string }
  inputs: Record<string, string>
  // Blocks add their own namespaced outputs here as the run proceeds.
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
  }
}

// Substitute `{{ path.to.value }}` references against the context. Dotted paths
// walk nested objects; an unknown path resolves to '' — templating is
// best-effort, so an optional value a block hasn't produced yet (e.g.
// `{{ preview.url }}` before ddev-start) just renders empty rather than failing.
export function render(template: string, ctx: RunContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>(
      (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      ctx,
    )
    return value == null ? '' : String(value)
  })
}
