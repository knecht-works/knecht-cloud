export interface ObjectContext {
  heading: string
  url: string
  facts: [string, string][]
  body: string
  comments: { author: string, at: Date, body: string }[]
}

const MAX_COMMENTS = 10

// What `knecht-object` prints: the same shape for every integration.
export function formatObjectContext(c: ObjectContext): string {
  const lines = [`# ${c.heading}`]
  if (c.url) lines.push(c.url)
  const facts = c.facts.filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`)
  if (facts.length) lines.push(facts.join(' · '))
  lines.push('', c.body.trim() || '(no description)')
  if (c.comments.length) {
    const shown = c.comments.slice(-MAX_COMMENTS)
    const count = shown.length < c.comments.length ? `, ${shown.length} of ${c.comments.length}` : ''
    lines.push('', `## Comments (newest last${count})`, '')
    for (const comment of shown) {
      lines.push(`**${comment.author}** (${comment.at.toISOString().slice(0, 10)}):\n${comment.body.trim()}`, '')
    }
  }
  return lines.join('\n').trimEnd()
}
