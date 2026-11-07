export const ELEVATION_TTL_MS = 60 * 60 * 1000

export function isElevated(elevatedAt: number | undefined, now = Date.now()): boolean {
  return elevatedAt !== undefined && now - elevatedAt < ELEVATION_TTL_MS
}
