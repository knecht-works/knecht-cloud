import { agentCookieName, previewAuthToken } from '#server/utils/preview-fetch'
import { dashboardOrigin } from '#server/utils/origin'
import { BRIDGE_HOST } from '#server/utils/agent-bridge'
import type { OpencodeMcpServer } from '#server/utils/opencode-config'

export const AGENT_BROWSER_MCP = 'knecht-browser'
export const AGENT_BROWSER_CONFIG_FILE = 'browser.json'
const CONFIG_PATH = `/var/www/html/.knecht/opencode/${AGENT_BROWSER_CONFIG_FILE}`
const OUTPUT_DIR = '/var/www/html/.knecht/browser'

export const AGENT_BROWSER_IMAGE_FILE = 'Dockerfile.knecht-browser'
// Its own playwright-core installs the browser build it looks for. Its apt-get update sees only
// Debian, where the libraries come from: a third-party repo mid-sync would fail the whole boot.
export const AGENT_BROWSER_DOCKERFILE = `ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npm install -g @playwright/mcp@0.0.84 \\
 && mkdir /tmp/knecht-apt && cp /etc/apt/sources.list.d/debian.sources /tmp/knecht-apt/ \\
 && echo 'Dir::Etc::sourceparts "/tmp/knecht-apt";' > /tmp/knecht-apt.conf \\
 && APT_CONFIG=/tmp/knecht-apt.conf "$(npm root -g)/@playwright/mcp/node_modules/.bin/playwright-core" install --with-deps --only-shell chromium \\
 && rm -rf /tmp/knecht-apt /tmp/knecht-apt.conf /var/lib/apt/lists/* /root/.npm
`

export function agentBrowserMcp(): OpencodeMcpServer {
  return { type: 'local', command: ['playwright-mcp', '--config', CONFIG_PATH], enabled: true }
}

// The browser logs in like a share guest, with a cookie that opens only this session's preview.
export function agentBrowserConfig(sessionId: number): string {
  const origin = new URL(dashboardOrigin())
  return JSON.stringify({
    browser: {
      browserName: 'chromium',
      isolated: true,
      launchOptions: { headless: true, args: hostResolverRules(origin) },
      contextOptions: {
        viewport: { width: 1280, height: 800 },
        storageState: {
          cookies: [{
            name: agentCookieName(sessionId),
            value: previewAuthToken(sessionId),
            domain: `.preview.${origin.hostname}`,
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: origin.protocol === 'https:',
            sameSite: 'Lax',
          }],
          origins: [],
        },
      },
    },
    outputDir: OUTPUT_DIR,
    imageResponses: 'allow',
  }, null, 2)
}

// The web container resolves the preview hosts to itself (extra_hosts), which would skip
// Knecht's proxy. On Knecht's own port the browser talks to Knecht directly; otherwise to
// the TLS proxy on the docker host, which keeps the name and so its certificate valid.
function hostResolverRules(origin: URL): string[] {
  const port = origin.port || (origin.protocol === 'https:' ? '443' : '80')
  const target = port === (process.env.NITRO_PORT || process.env.PORT || '3000') ? BRIDGE_HOST : 'host.docker.internal'
  return [`--host-resolver-rules=MAP *.preview.${origin.hostname} ${target}`]
}
