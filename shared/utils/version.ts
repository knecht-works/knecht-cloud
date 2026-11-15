export type VersionOp = '=' | '<' | '>'

function parts(version: string): number[] | null {
  return /^\d+(?:\.\d+)*$/.test(version) ? version.split('.').map(Number) : null
}

// = matches a prefix, so "5.4" covers 5.4.x; < and > read missing parts as zero.
export function matchesVersion(version: string | null, op: VersionOp, target: string): boolean {
  const v = version ? parts(version) : null
  const t = parts(target.trim())
  if (!v || !t) return false
  if (op === '=') return t.every((n, i) => v[i] === n)
  for (let i = 0; i < Math.max(v.length, t.length); i++) {
    const diff = (v[i] ?? 0) - (t[i] ?? 0)
    if (diff) return op === '<' ? diff < 0 : diff > 0
  }
  return false
}
