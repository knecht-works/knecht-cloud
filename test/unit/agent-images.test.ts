import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentImageFile, agentImageFiles } from '#shared/utils/agent-images'
import { readAgentImage } from '#server/utils/agent-images'

const SCREENSHOT_OUTPUT = `### Result
- [Screenshot of full page](/var/www/html/.knecht/browser/page-2026-11-21T12-46-23-813Z.png)
### Ran Playwright code
\`\`\`js
await page.screenshot({ path: '/var/www/html/.knecht/browser/page-2026-11-21T12-46-23-813Z.png' });
\`\`\``

describe('agentImageFiles', () => {
  it('finds the screenshot playwright-mcp reports, once', () => {
    expect(agentImageFiles(SCREENSHOT_OUTPUT)).toEqual(['page-2026-11-21T12-46-23-813Z.png'])
    expect(agentImageFiles('- [Screenshot of full page](.knecht/browser/page-2.png)')).toEqual(['page-2.png'])
    expect(agentImageFiles('- [Screenshot of full page](.knecht/browser/mobile-home.png)')).toEqual(['mobile-home.png'])
  })

  it('ignores links outside the browser output dir and other file types', () => {
    expect(agentImageFiles('[x](/var/www/html/web/page-1.png) [y](/var/www/html/.knecht/browser/page-1.yml) [z](/var/www/html/.knecht/browser/../page-1.png)')).toEqual([])
    expect(agentImageFiles(null)).toEqual([])
  })
})

describe('agentImageFile', () => {
  it('maps an image the agent embeds in its reply to the screenshot it took', () => {
    expect(agentImageFile('.knecht/browser/page-1.png')).toBe('page-1.png')
    expect(agentImageFile('/var/www/html/.knecht/browser/page-1.jpeg')).toBe('page-1.jpeg')
    expect(agentImageFile('https://example.com/.knecht/browser/page-1.png')).toBeNull()
    expect(agentImageFile('.knecht/browser/../page-1.png')).toBeNull()
  })
})

describe('readAgentImage', () => {
  let projects: string
  let browser: string

  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'knecht-images-'))
    vi.stubEnv('KNECHT_PROJECTS', projects)
    browser = join(projects, 'run-7', '.knecht', 'browser')
    mkdirSync(browser, { recursive: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(projects, { recursive: true, force: true })
  })

  it('reads a screenshot from the session checkout', async () => {
    writeFileSync(join(browser, 'page-1.png'), 'png')
    expect((await readAgentImage(7, 'page-1.png'))?.toString()).toBe('png')
    expect(await readAgentImage(8, 'page-1.png')).toBeNull()
  })

  it('never follows a symlink the sandbox planted, on the file or a directory', async () => {
    const secret = join(projects, 'secret.png')
    writeFileSync(secret, 'secret')
    symlinkSync(secret, join(browser, 'page-1.png'))
    expect(await readAgentImage(7, 'page-1.png')).toBeNull()

    rmSync(browser, { recursive: true })
    mkdirSync(join(projects, 'elsewhere'))
    writeFileSync(join(projects, 'elsewhere', 'page-2.png'), 'secret')
    symlinkSync(join(projects, 'elsewhere'), browser)
    expect(await readAgentImage(7, 'page-2.png')).toBeNull()
  })

  it('serves only image names', async () => {
    writeFileSync(join(browser, 'console-1.log'), 'log')
    expect(await readAgentImage(7, 'console-1.log')).toBeNull()
    expect(await readAgentImage(7, '../page-1.png')).toBeNull()
  })
})
