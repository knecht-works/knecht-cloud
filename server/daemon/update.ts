import { execa } from 'execa'
import { RELEASE_TAG_RE } from '../utils/version'

const IMAGE = 'ghcr.io/knecht-works/knecht-cloud'

// A container can't recreate itself, so a sibling container on the host daemon does it.
export async function startUpdate(tag: string): Promise<void> {
  if (!RELEASE_TAG_RE.test(tag)) throw new Error(`Not a release tag: ${tag}`)
  const dir = process.env.KNECHT_INSTALL_DIR || '/opt/knecht'

  const script = [
    'set -e',
    `git config --global --add safe.directory ${dir}`,
    'git fetch --tags origin',
    `git checkout -f ${tag}`,
    `sed -i 's/^KNECHT_VERSION=.*/KNECHT_VERSION=${tag}/' .env`,
    'docker compose pull -q',
    'docker compose up -d',
  ].join(' && ')

  await execa('docker', ['rm', '-f', 'knecht-updater']).catch(() => {})

  execa('docker', [
    'run', '-d', '--rm', '--name', 'knecht-updater',
    // Root: the checkout is root-owned.
    '-u', '0',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${dir}:${dir}`, '-w', dir,
    `${IMAGE}:${tag}`, 'sh', '-c', script,
  ]).catch(err => console.error('[update] failed to start updater:', err))
}
