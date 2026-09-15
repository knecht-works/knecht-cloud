// Every source fills every key, so a workflow can never reference an input
// that some trigger cannot provide.
export const INPUT_KEYS = ['event', 'identifier', 'title', 'body', 'url', 'status', 'assignee', 'labels', 'author'] as const

export type TriggerInputs = Record<typeof INPUT_KEYS[number], string>

export function emptyInputs(event = ''): TriggerInputs {
  return { event, identifier: '', title: '', body: '', url: '', status: '', assignee: '', labels: '', author: '' }
}
