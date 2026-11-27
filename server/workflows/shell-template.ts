import { lookup, valueText, type RunContext } from '#server/workflows/context'

type Mode
  = | { kind: 'code', closer: null | ')' | '`', depth: number, arith: boolean }
    | { kind: 'double' | 'single' | 'ansi' | 'comment' }
    | { kind: 'heredoc', delimiter: string, quoted: boolean, stripTabs: boolean }

type Heredoc = Extract<Mode, { kind: 'heredoc' }>

const REF_RE = /\{\{\s*([\w.]+)\s*\}\}/y
const WORD_BREAK = /[\s;&|()<>]/

// Values are never parsed as shell code: each one travels as an environment variable,
// and a quote-state misread can at worst split or not expand it, never run it. Only a
// quoted heredoc gets the value inline, since its body is never expanded.
// Bash arithmetic is the exception (it evaluates subscripts in a value's text), accepted
// because ticket values come from a trusted source.
export function renderShell(template: string, ctx: RunContext): { command: string, env: Record<string, string> } {
  const env: Record<string, string> = {}
  const names = new Map<string, string>()
  const varFor = (path: string): string => {
    let name = names.get(path)
    if (!name) {
      const base = `KNECHT_VAR_${path.replace(/\./g, '_').toUpperCase()}`
      name = base
      for (let n = 2; name in env; n++) name = `${base}_${n}`
      names.set(path, name)
      env[name] = valueText(lookup(path, ctx))
    }
    return `\${${name}}`
  }

  const stack: Mode[] = [{ kind: 'code', closer: null, depth: 0, arith: false }]
  const pending: Heredoc[] = []
  let out = ''
  let i = 0
  let lineStart = true

  while (i < template.length) {
    const mode = stack.at(-1)!

    if (mode.kind === 'heredoc' && lineStart) {
      const end = template.indexOf('\n', i)
      const line = template.slice(i, end === -1 ? undefined : end)
      if ((mode.stripTabs ? line.replace(/^\t+/, '') : line) === mode.delimiter) {
        out += line
        i += line.length
        stack.pop()
        if (pending.length) stack.push(pending.shift()!)
        lineStart = false
        continue
      }
    }

    REF_RE.lastIndex = i
    const ref = REF_RE.exec(template)
    if (ref) {
      i += ref[0].length
      lineStart = false
      if (mode.kind === 'comment') {
        out += ref[0]
        continue
      }
      if (mode.kind === 'heredoc' && mode.quoted) {
        out += heredocText(ref[1]!, valueText(lookup(ref[1]!, ctx)), mode)
        continue
      }
      const v = varFor(ref[1]!)
      out += mode.kind === 'single'
        ? `'"${v}"'`
        : mode.kind === 'ansi' ? `'"${v}"$'` : v
      continue
    }

    const c = template[i]!
    const next = template[i + 1]
    let len = 1

    if (mode.kind === 'code') {
      const prev = template[i - 1]
      if (c === '\\') len = 2
      else if (c === '\'') stack.push({ kind: 'single' })
      else if (c === '"') stack.push({ kind: 'double' })
      else if (c === '$' && next === '\'') {
        stack.push({ kind: 'ansi' })
        len = 2
      }
      else if (c === '$' && next === '(') {
        const arith = template[i + 2] === '('
        stack.push({ kind: 'code', closer: ')', depth: 0, arith })
        len = 2
      }
      else if (c === '`') {
        if (mode.closer === '`') stack.pop()
        else stack.push({ kind: 'code', closer: '`', depth: 0, arith: false })
      }
      else if (c === '(' && next === '(' && (prev === undefined || /[\s;&|(!]/.test(prev))) {
        stack.push({ kind: 'code', closer: ')', depth: 0, arith: true })
      }
      else if (c === '(' && mode.closer === ')') mode.depth++
      else if (c === ')' && mode.closer === ')') {
        if (mode.depth === 0) stack.pop()
        else mode.depth--
      }
      else if (c === '#' && (prev === undefined || WORD_BREAK.test(prev))) stack.push({ kind: 'comment' })
      else if (c === '<' && next === '<' && !mode.arith) {
        if (template[i + 2] === '<') len = 3
        else {
          const heredoc = readHeredocOperator(template, i)
          pending.push(heredoc.mode)
          len = heredoc.length
        }
      }
      else if (c === '\n' && pending.length) stack.push(pending.shift()!)
    }
    else if (mode.kind === 'double' || (mode.kind === 'heredoc' && !mode.quoted)) {
      if (c === '\\') len = 2
      else if (c === '"' && mode.kind === 'double') stack.pop()
      else if (c === '$' && next === '(') {
        stack.push({ kind: 'code', closer: ')', depth: 0, arith: template[i + 2] === '(' })
        len = 2
      }
      else if (c === '`') stack.push({ kind: 'code', closer: '`', depth: 0, arith: false })
    }
    else if (mode.kind === 'single') {
      if (c === '\'') stack.pop()
    }
    else if (mode.kind === 'ansi') {
      if (c === '\\') len = 2
      else if (c === '\'') stack.pop()
    }
    else if (mode.kind === 'comment') {
      if (c === '\n') {
        stack.pop()
        continue
      }
    }

    out += template.slice(i, i + len)
    i += len
    lineStart = c === '\n'
  }

  return { command: out, env }
}

// A quoted heredoc body is never expanded, so the value can sit there as text, as long as
// none of its lines ends the heredoc early.
function heredocText(path: string, value: string, mode: Heredoc): string {
  if (value.split('\n').some(line => (mode.stripTabs ? line.replace(/^\t+/, '') : line) === mode.delimiter)) {
    throw new Error(`{{ ${path} }} contains the line ${mode.delimiter}, which would end the heredoc <<'${mode.delimiter}' early.`)
  }
  return value
}

function readHeredocOperator(template: string, start: number): { mode: Heredoc, length: number } {
  let i = start + 2
  const stripTabs = template[i] === '-'
  if (stripTabs) i++
  while (template[i] === ' ' || template[i] === '\t') i++
  let word = ''
  while (i < template.length && !WORD_BREAK.test(template[i]!)) word += template[i++]
  const delimiter = word.replace(/["'\\]/g, '')
  return {
    mode: { kind: 'heredoc', delimiter, quoted: delimiter !== word, stripTabs },
    length: i - start,
  }
}
