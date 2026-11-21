import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentBrowserConfig, agentBrowserMcp } from '#server/utils/agent-browser'
import { isPreviewAuthToken } from '#server/utils/preview-fetch'

interface BrowserConfig {
  browser: {
    launchOptions: { args: string[] }
    contextOptions: { storageState: { cookies: { name: string, value: string, domain: string, secure: boolean, httpOnly: boolean }[] } }
  }
  outputDir: string
}

const config = (sessionId: number) => JSON.parse(agentBrowserConfig(sessionId)) as BrowserConfig

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('agent browser', () => {
  it('runs playwright-mcp inside the sandbox with the generated config', () => {
    expect(agentBrowserMcp()).toEqual({ type: 'local', command: ['playwright-mcp', '--config', '/var/www/html/.knecht/opencode/browser.json'], enabled: true })
    expect(config(7).outputDir).toBe('/var/www/html/.knecht/browser')
  })

  it('logs in with a cookie that opens only this session\'s previews', () => {
    const [cookie] = config(7).browser.contextOptions.storageState.cookies
    expect(cookie).toMatchObject({ name: 'knecht-agent-7', domain: '.preview.knecht.test', httpOnly: true, secure: false })
    expect(isPreviewAuthToken(cookie!.value, 7)).toBe(true)
    expect(isPreviewAuthToken(cookie!.value, 8)).toBe(false)
  })

  it('routes the preview domain to Knecht when Knecht serves it on its own port', () => {
    vi.stubEnv('KNECHT_BASE_URL', 'http://lvh.me:3333')
    vi.stubEnv('PORT', '3333')
    expect(config(7).browser.launchOptions.args).toEqual(['--host-resolver-rules=MAP *.preview.lvh.me knecht-bridge'])
  })

  it('routes the preview domain to the TLS proxy on the docker host, with a secure cookie', () => {
    vi.stubEnv('KNECHT_BASE_URL', 'https://knecht.example.com')
    const { browser } = config(7)
    expect(browser.launchOptions.args).toEqual(['--host-resolver-rules=MAP *.preview.knecht.example.com host.docker.internal'])
    expect(browser.contextOptions.storageState.cookies[0]!.secure).toBe(true)
  })
})
