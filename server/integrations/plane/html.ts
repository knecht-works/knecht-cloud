// Plane stores descriptions and comments as HTML. Both directions cover the
// subset Knecht's replies use: paragraphs, headings, lists, fenced code,
// rules, inline code, bold and links. Anything else stays plain text.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return ''
  let s = html.replace(/\r\n/g, '\n')
  // Entities stay encoded until the end: a decoded `<` would look like a tag to the strip below.
  s = s.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, code: string) => `\n\n\`\`\`\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`)
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => `\n\n\`\`\`\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`)
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${text}\n\n`)
  s = s.replace(/<mention-component[^>]*?label="([^"]*)"[^>]*>[\s\S]*?<\/mention-component>/gi, '@$1')
  s = s.replace(/<mention-component[^>]*>[\s\S]*?<\/mention-component>/gi, '@user')
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, body: string) => {
    let n = 0
    return `\n\n${body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, item: string) => `${++n}. ${item.trim()}\n`)}\n`
  })
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, body: string) => `\n\n${body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__, item: string) => `- ${item.trim()}\n`)}\n`)
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => text === href ? href : `[${text}](${href})`)
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  s = s.replace(/<\/(p|div|blockquote|li)>/gi, '\n\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function markdownToHtml(markdown: string): string {
  const out: string[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join('<br>'))}</p>`)
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !/^```\s*$/.test(lines[i]!)) code.push(lines[i]!)
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    if (/^\s*$/.test(line)) {
      flush()
      continue
    }
    if (/^-{3,}\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flush()
      out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`)
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flush()
      const ordered = !!numbered
      const items: string[] = []
      let j = i
      while (j < lines.length) {
        const m = ordered ? lines[j]!.match(/^\s*\d+[.)]\s+(.*)$/) : lines[j]!.match(/^\s*[-*]\s+(.*)$/)
        if (!m) break
        items.push(`<li>${inline(m[1]!)}</li>`)
        j++
      }
      i = j - 1
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    paragraph.push(escapeHtml(line))
  }
  flush()
  return out.join('') || '<p></p>'
}

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)]*[^\s<>).,;:!?])/g

// Input is already HTML-escaped, so the markers themselves are safe to match.
function inline(text: string): string {
  return text.replace(INLINE_RE, (raw, code?: string, strong?: string, link?: string, url?: string) => {
    if (code) return `<code>${code.slice(1, -1)}</code>`
    if (strong) return `<strong>${strong.slice(2, -2)}</strong>`
    if (link) {
      const [, label, href] = link.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!
      return `<a href="${href}">${label}</a>`
    }
    if (url) return `<a href="${url}">${url}</a>`
    return raw
  })
}
