export const AGENT_IMAGE_DIR = '.knecht/browser'
export const AGENT_IMAGE_FILE = /^page-[\w-]+\.(?:png|jpe?g)$/

const SCREENSHOT_LINK = /\]\((?:\/var\/www\/html\/)?\.knecht\/browser\/(page-[\w-]+\.(?:png|jpe?g))\)/g

// playwright-mcp links the file it wrote, absolute or relative to the project depending on its cwd.
export function agentImageFiles(output: string | null): string[] {
  return [...new Set([...(output ?? '').matchAll(SCREENSHOT_LINK)].map(m => m[1]!))]
}

export function agentImageUrl(sessionId: number, file: string): string {
  return `/api/sessions/${sessionId}/agent-images/${file}`
}
