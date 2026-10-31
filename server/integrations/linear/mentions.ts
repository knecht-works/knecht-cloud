import { splitMentions, type Person } from '../tracker'

interface BodyNode {
  type?: string
  attrs?: { id?: string }
  content?: BodyNode[]
}

function mentionIds(node: BodyNode): string[] {
  const own = /mention/i.test(node.type ?? '') && node.attrs?.id ? [node.attrs.id] : []
  return [...own, ...(node.content ?? []).flatMap(mentionIds)]
}

export type LinearPerson = Person & { handle: string }

// Linear only turns "@handle" into a mention, while the agent writes the full name it read in the thread.
export function withHandles(markdown: string, people: LinearPerson[]): string {
  return splitMentions(markdown, people).map(part => typeof part === 'string' ? part : `@${part.handle}`).join('')
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A reply opens with "@handle", on a line of its own when the text starts with a block like a heading or a list.
export function addressedTo(markdown: string, handle: string): string {
  const mention = `@${handle}`
  if (new RegExp(`${escapeRegExp(mention)}(?![\\w-]|\\.\\w)`).test(markdown)) return markdown
  return /^(#|[-*+] |\d+\. |```|>|\|)/.test(markdown) ? `${mention}\n\n${markdown}` : `${mention} ${markdown}`
}

// The markdown body only carries the display name; the user id of a mention is in the editor document.
export function bodyDataMentionIds(bodyData: string | null | undefined): string[] {
  if (!bodyData) return []
  try {
    return mentionIds(JSON.parse(bodyData) as BodyNode)
  }
  catch {
    return []
  }
}
