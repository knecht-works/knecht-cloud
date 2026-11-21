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
