import type { Project } from '../db/schema'
import { runWorkspacePath } from '../../shared/utils/routes'
import { STEP_META_KEYS, type Condition, type Step } from '../../shared/utils/workflow'
import { tryParseJson } from '../utils/json'
import { dashboardOrigin } from '../utils/origin'

export interface RunContext {
  run: { id: number, url: string }
  project: { name: string, owner: string, fullName: string, defaultBranch: string }
  inputs: Record<string, string>
  steps: Record<string, Record<string, unknown>>
  [output: string]: unknown
}

export function createContext(
  runId: number,
  project: Project,
  inputs: Record<string, string> = {},
): RunContext {
  return {
    run: { id: runId, url: `${dashboardOrigin()}${runWorkspacePath(project.id, runId)}` },
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

const META_KEYS = new Set<string>(STEP_META_KEYS)

const SINGLE_REF_RE = /^\{\{\s*([\w.]+)\s*\}\}$/

export function renderStepParams<S extends Step>(step: S, ctx: RunContext, rawParams: readonly string[] = []): S {
  const rendered = { ...step } as Record<string, unknown>
  for (const [key, value] of Object.entries(rendered)) {
    if (typeof value !== 'string' || META_KEYS.has(key)) continue
    const single = rawParams.includes(key) ? value.trim().match(SINGLE_REF_RE) : null
    rendered[key] = single ? lookup(single[1]!, ctx) : render(value, ctx)
  }
  return rendered as S
}

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

const MAX_LOOP_ITERATIONS = 1000

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
