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

// The subset Knecht's own replies use: paragraphs, headings, bullet and
// numbered lists, fenced code, rules, inline code, bold and links. Anything
// else stays plain text, never a failed comment.
export function markdownToAdf(markdown: string): AdfNode {
  const content: AdfNode[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) content.push({ type: 'paragraph', content: inlineNodes(paragraph.join('\n')) })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !/^```\s*$/.test(lines[i]!)) code.push(lines[i]!)
      const node: AdfNode = { type: 'codeBlock', content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] }
      if (fence[1]) node.attrs = { language: fence[1] }
      content.push(node)
      continue
    }
    if (/^\s*$/.test(line)) {
      flush()
      continue
    }
    if (/^-{3,}\s*$/.test(line)) {
      flush()
      content.push({ type: 'rule' })
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flush()
      content.push({ type: 'heading', attrs: { level: heading[1]!.length }, content: inlineNodes(heading[2]!) })
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flush()
      const ordered = !!numbered
      const items: AdfNode[] = []
      let j = i
      while (j < lines.length) {
        const m = ordered ? lines[j]!.match(/^\s*\d+[.)]\s+(.*)$/) : lines[j]!.match(/^\s*[-*]\s+(.*)$/)
        if (!m) break
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes(m[1]!) }] })
        j++
      }
      i = j - 1
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items })
      continue
    }
    paragraph.push(line)
  }
  flush()

  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] } as AdfNode
}

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)]*[^\s<>).,;:!?])/g

function inlineNodes(text: string): AdfNode[] {
  const nodes: AdfNode[] = []
  const pushText = (chunk: string) => {
    const parts = chunk.split('\n')
    parts.forEach((part, index) => {
      if (part) nodes.push({ type: 'text', text: part })
      if (index < parts.length - 1) nodes.push({ type: 'hardBreak' })
    })
  }
  let last = 0
  for (const match of text.matchAll(INLINE_RE)) {
    pushText(text.slice(last, match.index))
    const [raw, code, strong, link, url] = match
    if (code) nodes.push({ type: 'text', text: code.slice(1, -1), marks: [{ type: 'code' }] })
    else if (strong) nodes.push({ type: 'text', text: strong.slice(2, -2), marks: [{ type: 'strong' }] })
    else if (link) {
      const [, label, href] = link.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!
      nodes.push({ type: 'text', text: label!, marks: [{ type: 'link', attrs: { href: href! } }] })
    }
    else if (url) nodes.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
    last = match.index + raw.length
  }
  pushText(text.slice(last))
  return nodes
}
