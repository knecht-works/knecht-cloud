export const AGENT_IMAGE_DIR = '.knecht/browser'
const FILE = String.raw`[\w-]+\.(?:png|jpe?g)`
export const AGENT_IMAGE_FILE = new RegExp(`^${FILE}$`)

// Tool output links the absolute path, an agent reply embeds the one relative to the project.
const IMAGE_PATH = String.raw`(?:\/var\/www\/html\/)?\.knecht\/browser\/(${FILE})`
const SCREENSHOT_LINK = new RegExp(String.raw`\]\(${IMAGE_PATH}\)`, 'g')
const IMAGE_SRC = new RegExp(`^${IMAGE_PATH}$`)

export function agentImageFiles(output: string | null): string[] {
  return [...new Set([...(output ?? '').matchAll(SCREENSHOT_LINK)].map(m => m[1]!))]
}

export function agentImageFile(src: string): string | null {
  return IMAGE_SRC.exec(src)?.[1] ?? null
}

export function agentImageUrl(sessionId: number, file: string): string {
  return `/api/sessions/${sessionId}/agent-images/${file}`
}
