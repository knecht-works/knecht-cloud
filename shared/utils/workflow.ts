export const DEFAULT_STEP_TIMEOUT_SECONDS = 600
export const STEP_TIMEOUT_DEFAULTS: Partial<Record<Step['type'], number>> = {
  'ai': 3600,
  'link-check': 1800,
}

export function defaultStepTimeout(type: Step['type']): number {
  return STEP_TIMEOUT_DEFAULTS[type] ?? DEFAULT_STEP_TIMEOUT_SECONDS
}

export interface StepRetry {
  attempts: number
  backoffSeconds: number
}

// Optional only because pre-id rows exist in the DB; ensureStepIds backfills on every load/save.
export interface StepMeta {
  id?: string
  label?: string
  description?: string
  continueOnError?: boolean
  timeoutSeconds?: number
  retry?: StepRetry
}

export const STEP_META_KEYS = ['type', 'id', 'label', 'description', 'continueOnError', 'timeoutSeconds', 'retry'] as const

// Deliberately not evaluated JS: user code belongs in the sandboxed js step, not the control plane.
export const CONDITION_OPS = ['eq', 'neq', 'contains', 'not-contains', 'empty', 'not-empty', 'gt', 'lt', 'regex'] as const
export type ConditionOp = typeof CONDITION_OPS[number]

export interface Condition {
  left: string
  op: ConditionOp
  right?: string
}

export type Step = StepMeta & (
  | { type: 'ddev-start', commands?: string }
  | { type: 'bash', command: string }
  | { type: 'ai', prompt: string, model?: string, system?: string, output?: string }
  | { type: 'js', code: string, input?: string }
  | { type: 'http', method: string, url: string, headers?: string, body?: string }
  | { type: 'if', conditions: Condition[][], then: Step[], else: Step[] }
  | { type: 'loop', items: string, steps: Step[] }
  | { type: 'link-check', sitemap?: string, urls?: string, failOnBroken?: boolean }
  | { type: 'create-branch', name: string }
  | { type: 'create-commit', message: string }
  | { type: 'create-pr', title: string, body: string }
)

export const COMPOSITE_CHILD_KEYS = {
  if: ['then', 'else'],
  loop: ['steps'],
} as const satisfies Partial<Record<Step['type'], readonly string[]>>

export type CompositeStep = Extract<Step, { type: keyof typeof COMPOSITE_CHILD_KEYS }>

export function isComposite(step: Step): step is CompositeStep {
  return isCompositeType(step.type)
}

export function isCompositeType(type: Step['type']): type is CompositeStep['type'] {
  return type in COMPOSITE_CHILD_KEYS
}

export function stepsInclude(steps: Step[], type: Step['type']): boolean {
  return steps.some(step => step.type === type
    || stepChildren(step).some(children => stepsInclude(children, type)))
}

export function stepChildren(step: Step): Step[][] {
  if (!isComposite(step)) return []
  const record = step as unknown as Record<string, Step[] | undefined>
  return COMPOSITE_CHILD_KEYS[step.type].map(key => record[key] ?? [])
}

export function mapStepChildren(step: Step, fn: (children: Step[]) => Step[]): Step {
  if (!isComposite(step)) return step
  const record = step as unknown as Record<string, Step[]>
  const patch = Object.fromEntries(COMPOSITE_CHILD_KEYS[step.type].map(key => [key, fn(record[key]!)]))
  return { ...step, ...patch }
}

export function flattenSteps(steps: Step[]): Step[] {
  return steps.flatMap(step => [step, ...flattenSteps(stepChildren(step).flat())])
}

export const MAX_STEP_DEPTH = 3

export function stepTreeDepth(steps: Step[]): number {
  let max = 0
  for (const step of steps) {
    const children = stepChildren(step)
    const depth = 1 + (children.length ? Math.max(...children.map(stepTreeDepth)) : 0)
    if (depth > max) max = depth
  }
  return max
}

// The name doubles as the URL segment, so only what stays URL-safe once encoded.
export const WORKFLOW_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u

function declaredIds(flat: Step[]): Set<string> {
  return new Set(flat.map(s => s.id).filter((id): id is string => !!id))
}

export function ensureStepIds(steps: Step[]): Step[] {
  const flat = flattenSteps(steps)
  const declared = declaredIds(flat)
  if (declared.size === flat.length) return steps

  const assigned = new Set<string>()
  const assign = (list: Step[]): Step[] => list.map((step) => {
    let id = step.id
    if (!id || assigned.has(id)) {
      id = deriveStepId(step.label || step.type, new Set([...declared, ...assigned]))
    }
    assigned.add(id)
    const next: Step = step.id === id ? step : { ...step, id }
    return mapStepChildren(next, assign)
  })
  return assign(steps)
}

// Must fit render()'s `[\w.]+` path grammar: hyphens don't match.
export const STEP_ID_RE = /^[a-z][a-z0-9_]*$/

export function slugifyStepId(label: string): string {
  const base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) return ''
  return (/^[a-z]/.test(base) ? base : `s_${base}`).slice(0, 40).replace(/_+$/, '')
}

export function stepIds(steps: Step[]): Set<string> {
  return declaredIds(flattenSteps(steps))
}

export function deriveStepId(label: string, taken: Set<string>): string {
  const slug = slugifyStepId(label) || 'step'
  if (!taken.has(slug)) return slug
  for (let n = 2; ; n++) {
    if (!taken.has(`${slug}_${n}`)) return `${slug}_${n}`
  }
}

export function isDerivedStepId(id: string, label: string): boolean {
  const slug = slugifyStepId(label) || 'step'
  return id === slug || (id.startsWith(`${slug}_`) && /^\d+$/.test(id.slice(slug.length + 1)))
}

export function renameStepReferences(steps: Step[], oldId: string, newId: string): void {
  const re = new RegExp(`(\\{\\{\\s*steps\\.)${oldId}(?=[.\\s}])`, 'g')
  const rewrite = (text: string) => text.replace(re, `$1${newId}`)
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'string') (value as unknown[])[i] = rewrite(item)
        else walk(item)
      })
    }
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const [key, item] of Object.entries(record)) {
        if (typeof item === 'string') record[key] = rewrite(item)
        else walk(item)
      }
    }
  }
  for (const step of flattenSteps(steps)) {
    const skip = new Set<string>([...STEP_META_KEYS, ...(isComposite(step) ? COMPOSITE_CHILD_KEYS[step.type] : [])])
    const record = step as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (skip.has(key)) continue
      if (typeof value === 'string') record[key] = rewrite(value)
      else walk(value)
    }
  }
}

export const AI_OUTPUT_TYPES = ['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'] as const
export type AiOutputType = typeof AI_OUTPUT_TYPES[number]
export interface AiOutputField { name: string, type: AiOutputType }

function parseAiOutputLine(raw: string): AiOutputField | Error | null {
  const line = raw.trim()
  if (!line) return null
  const colon = line.indexOf(':')
  if (colon === -1) return new Error(`Invalid output field '${line}': expected 'name: type'`)
  const name = line.slice(0, colon).trim()
  const type = line.slice(colon + 1).trim()
  if (!/^\w+$/.test(name)) return new Error(`Invalid output field name '${name}': use letters, digits, underscore`)
  if (!(AI_OUTPUT_TYPES as readonly string[]).includes(type)) {
    return new Error(`Invalid type '${type}' for '${name}': use one of ${AI_OUTPUT_TYPES.join(', ')}`)
  }
  return { name, type: type as AiOutputType }
}

export function parseAiOutputSpec(spec: string): AiOutputField[] {
  const fields: AiOutputField[] = []
  for (const raw of spec.split('\n')) {
    const parsed = parseAiOutputLine(raw)
    if (parsed instanceof Error) throw parsed
    if (parsed) fields.push(parsed)
  }
  if (!fields.length) throw new Error('output defines no fields')
  return fields
}

export function aiOutputFields(spec: string): AiOutputField[] {
  const fields: AiOutputField[] = []
  for (const raw of spec.split('\n')) {
    const parsed = parseAiOutputLine(raw)
    if (parsed && !(parsed instanceof Error)) fields.push(parsed)
  }
  return fields
}
