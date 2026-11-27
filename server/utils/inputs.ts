// Every source fills every key, so a workflow can never reference an input
// that some trigger cannot provide.
export const INPUT_KEYS = ['event', 'identifier', 'title', 'body', 'url', 'status', 'assignee', 'labels', 'author'] as const

export type TriggerInputs = Record<Exclude<typeof INPUT_KEYS[number], 'labels'>, string> & { labels: string[] }

export function emptyInputs(event = ''): TriggerInputs {
  return { event, identifier: '', title: '', body: '', url: '', status: '', assignee: '', labels: [], author: '' }
}

export function labelList(text: string): string[] {
  return text.split(',').map(label => label.trim()).filter(Boolean)
}
