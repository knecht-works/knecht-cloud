// Star count capped so the preview does not leak the key length.
export function keyPreview(key: string): string {
  if (key.length <= 12) return '*'.repeat(key.length)
  return `${key.slice(0, 8)}${'*'.repeat(Math.min(key.length - 12, 16))}${key.slice(-4)}`
}
