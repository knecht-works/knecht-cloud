import { CLEAR_COMMAND, COMPACT_COMMAND, PR_COMMAND, PUBLISH_FOLLOWUP_PROMPT } from '#shared/utils/followup'

// The stored prompt of a command is the long instruction; the chat shows the short form the user typed.
export function displayPrompt(prompt: string): string {
  if (prompt === PUBLISH_FOLLOWUP_PROMPT) return 'Open a PR'
  if (prompt === COMPACT_COMMAND) return 'Compact the conversation'
  if (prompt === CLEAR_COMMAND) return 'New conversation'
  return prompt
}

export function recallPrompt(prompt: string): string {
  return prompt === PUBLISH_FOLLOWUP_PROMPT ? PR_COMMAND : prompt
}

// Today shows the time only; anything older carries the date, with the year once it differs.
export function chatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return time
  const day = date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
  return `${day}, ${time}`
}

// The async clipboard exists only in secure contexts; a dev instance on http://lvh.me has none.
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('Clipboard unavailable')
}
