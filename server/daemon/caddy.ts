import { execa } from 'execa'
import { knechtContainer } from '#server/daemon/sandbox'

const CADDYFILE = '/etc/caddy/Caddyfile'

// An update checks the Caddyfile out as a new file, while caddy's file bind mount keeps
// the one it started with, and caddy reads its config only at start.
export async function syncCaddyfile(): Promise<boolean> {
  const self = await knechtContainer()
  if (!self) return false
  const project = (await execa('docker', ['inspect', '-f', '{{index .Config.Labels "com.docker.compose.project"}}', self])).stdout.trim()
  if (!project) return false
  const caddy = (await execa('docker', [
    'ps', '-q',
    '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=caddy',
  ])).stdout.trim().split('\n')[0]
  if (!caddy) return false
  const mount = `{{range .Mounts}}{{if eq .Destination "${CADDYFILE}"}}{{.Source}}{{end}}{{end}}`
  const [image, source] = (await execa('docker', ['inspect', '-f', `{{.Config.Image}}|${mount}`, caddy])).stdout.trim().split('|')
  if (!image || !source) return false
  const [running, onDisk] = await Promise.all([
    execa('docker', ['exec', caddy, 'cat', CADDYFILE]),
    execa('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', '-v', `${source}:/Caddyfile:ro`, image, '/Caddyfile']),
  ])
  if (running.stdout === onDisk.stdout) return false
  await execa('docker', ['restart', caddy])
  return true
}
