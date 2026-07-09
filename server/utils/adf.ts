// Minimal ADF (Atlassian Document Format) → Markdown conversion. Jira Cloud
// returns issue descriptions and comments as an ADF JSON tree; the agent reads
// `{{ inputs.body }}` as text, so the common nodes are rendered as Markdown and
// anything unknown falls back to its text content. Deliberately not a complete
// ADF renderer (tables, panels, media get a plain-text approximation at most).

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
      // Unknown block (table, panel, expand, …): keep whatever text it holds.
      return node.content ? blocks(node.content, indent) : inline([node])
  }
}

// A listItem's first paragraph becomes the bullet text; further blocks are
// indented under it.
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
    if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`
  }
  return text
}
