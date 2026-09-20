// An integration describes its connection as data. The settings panel, the
// validation on both sides and the stored shape all derive from it.

export interface ConnectionFieldDef {
  key: string
  label: string
  // `url` must be https and loses its trailing slashes, `secret` is stored encrypted and only ever shown as a preview.
  type: 'text' | 'url' | 'email' | 'secret'
  placeholder?: string
  default?: string
  mono?: boolean
  required: string
  pattern?: string
  invalid?: string
}

export type WebhookRejectReason = 'signature' | 'empty-body' | 'no-project'

export interface ConnectionFormDef {
  intro: string
  docs?: { label: string, url: string }
  fields: ConnectionFieldDef[]
  rejected: string
  webhook: {
    // `minted`: Knecht generates the secret and the admin copies it into the tool.
    // `pasted`: the tool generates it and the admin pastes it here.
    secret: 'minted' | 'pasted'
    // `{key}` is replaced by the connection's value of that field.
    setupUrl: string
    instructions: string
    events: Record<string, string>
    rejectCopy: Record<WebhookRejectReason, string>
  }
}

export interface ConnectionStatus {
  configured: boolean
  accountName: string | null
  accountId: string | null
  values: Record<string, string>
  previews: Record<string, string>
  webhookUrl: string | null
  webhookSecret: string | null
  lastDelivery: { at: number, summary: string } | null
  lastRejected: { at: number, reason: WebhookRejectReason } | null
}

const FORMATS: Partial<Record<ConnectionFieldDef['type'], RegExp>> = {
  url: /^https:\/\/[^\s/]+/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
}

export function normalizeConnection(form: ConnectionFormDef, input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(form.fields.map((field) => {
    const raw = input[field.key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    return [field.key, field.type === 'url' ? value.replace(/\/+$/, '') : value]
  }))
}

export function connectionIssues(form: ConnectionFormDef, values: Record<string, string>): Record<string, string> {
  const issues: Record<string, string> = {}
  for (const field of form.fields) {
    const value = values[field.key] ?? ''
    const format = field.pattern ? new RegExp(field.pattern, 'i') : FORMATS[field.type]
    if (!value) issues[field.key] = field.required
    else if (format && !format.test(value)) issues[field.key] = field.invalid ?? field.required
  }
  return issues
}
