export interface DiffLine {
  type: 'same' | 'removed' | 'added'
  text: string
}

const MAX_LINES = 400

// Longest common subsequence over lines; enough for the file sizes an edit tool reports.
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [...a.map(text => ({ type: 'removed' as const, text })), ...b.map(text => ({ type: 'added' as const, text }))]
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! })
      i++
      j++
    }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: 'removed', text: a[i++]! })
    }
    else {
      out.push({ type: 'added', text: b[j++]! })
    }
  }
  while (i < a.length) out.push({ type: 'removed', text: a[i++]! })
  while (j < b.length) out.push({ type: 'added', text: b[j++]! })
  return out
}

function splitLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\n$/, '').split('\n')
}
