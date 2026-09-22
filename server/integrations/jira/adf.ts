import { markdownToAdf as toAdf } from 'marklassian'
import { splitMentions, type Person } from '../tracker'

export interface AdfNode {
  type?: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
  marks?: { type?: string, attrs?: Record<string, unknown> }[]
}

export function adfToMarkdown(doc: AdfNode | null | undefined): string {
  if (!doc) return ''
  return blocks(doc.content ?? []).trim()
}

function blocks(nodes: AdfNode[], indent = ''): string {
  return nodes.map(n => block(n, indent)).filter(Boolean).join('\n\n')
}

function block(node: AdfNode, indent: string): string {
  switch (node.type) {
    case 'paragraph':
      return indent + inline(node.content ?? [])
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `${indent}${'#'.repeat(level)} ${inline(node.content ?? [])}`
    }
    case 'bulletList':
      return (node.content ?? []).map(li => `${indent}- ${listItem(li, indent)}`).join('\n')
    case 'orderedList':
      return (node.content ?? []).map((li, i) => `${indent}${i + 1}. ${listItem(li, indent)}`).join('\n')
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `${indent}\`\`\`${lang}\n${inline(node.content ?? [])}\n${indent}\`\`\``
    }
    case 'blockquote':
      return blocks(node.content ?? [], indent).split('\n').map(l => `> ${l}`).join('\n')
    case 'rule':
      return `${indent}---`
    case 'mediaSingle':
    case 'mediaGroup':
      return `${indent}[attachment]`
    default:
      return node.content ? blocks(node.content, indent) : inline([node])
  }
}

function listItem(li: AdfNode, indent: string): string {
  const [first, ...rest] = li.content ?? []
  const head = first ? block(first, '') : ''
  if (!rest.length) return head
  return `${head}\n${blocks(rest, `${indent}  `)}`
}

function inline(nodes: AdfNode[]): string {
  return nodes.map((n) => {
    if (n.type === 'hardBreak') return '\n'
    if (n.type === 'mention') return String(n.attrs?.text ?? '@user')
    if (n.type === 'emoji') return String(n.attrs?.shortName ?? '')
    if (n.type === 'inlineCard') return String(n.attrs?.url ?? '')
    if (n.type === 'text') return marked(n)
    return n.content ? inline(n.content) : ''
  }).join('')
}

function marked(node: AdfNode): string {
  let text = node.text ?? ''
  for (const mark of node.marks ?? []) {
    if (mark.type === 'code') text = `\`${text}\``
    if (mark.type === 'strong') text = `**${text}**`
    if (mark.type === 'em') text = `*${text}*`
    if (mark.type === 'link') {
      const href = String(mark.attrs?.href ?? '')
      text = href === text ? text : `[${text}](${href})`
    }
  }
  return text
}

export function adfMentionIds(doc: AdfNode | null | undefined): string[] {
  const ids: string[] = []
  const walk = (node: AdfNode) => {
    if (node.type === 'mention' && typeof node.attrs?.id === 'string') ids.push(node.attrs.id)
    for (const child of node.content ?? []) walk(child)
  }
  if (doc) walk(doc)
  return ids
}

export function markdownToAdf(markdown: string, people: Person[] = []): AdfNode {
  const doc: AdfNode = toAdf(markdown)
  if (!doc.content?.length) doc.content = [{ type: 'paragraph', content: [] }]
  if (people.length) doc.content = withMentions(doc.content, people)
  return doc
}

function withMentions(nodes: AdfNode[], people: Person[]): AdfNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'codeBlock') return [node]
    if (node.type !== 'text' || node.marks?.some(m => m.type === 'code')) {
      return [node.content ? { ...node, content: withMentions(node.content, people) } : node]
    }
    return splitMentions(node.text ?? '', people).map(part => typeof part === 'string'
      ? { ...node, text: part }
      : { type: 'mention', attrs: { id: part.id, text: `@${part.name}` } })
  })
}
