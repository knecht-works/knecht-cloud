// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
