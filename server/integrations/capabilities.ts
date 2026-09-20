export function labelChangeSummary(add: string[], remove: string[]): string {
  return [add.length ? `added ${add.join(', ')}` : '', remove.length ? `removed ${remove.join(', ')}` : ''].filter(Boolean).join('; ')
}
