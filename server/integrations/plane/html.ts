import { Marked } from 'marked'
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  hr: '---',
  emDelimiter: '*',
})

turndown.addRule('bareLink', {
  filter: node => node.nodeName === 'A' && node.textContent === node.getAttribute('href'),
  replacement: content => content,
})

// Plane mentions are empty custom elements, which turndown drops together with the space after them.
const MENTION_RE = /<mention-component\b([^>]*)>\s*<\/mention-component>/gi

export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return ''
  const named = html.replace(MENTION_RE, (_, attrs: string) => `@${attrs.match(/\blabel="([^"]*)"/)?.[1] || 'user'}`)
  return turndown.turndown(named).trim()
}

export function htmlMentionIds(html: string | null | undefined): string[] {
  return [...(html ?? '').matchAll(MENTION_RE)].flatMap(([, attrs]) => [...attrs!.matchAll(/="([^"]*)"/g)].map(m => m[1]!))
}

// Raw HTML in an agent's reply is text, not markup to hand to Plane.
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  },
})

export function markdownToHtml(markdown: string): string {
  // Plane's editor shows the newlines marked puts between blocks as empty paragraphs.
  return marked.parse(markdown, { async: false }).trim().replace(/>\n+</g, '><') || '<p></p>'
}
