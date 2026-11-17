import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
}

// A bare origin with `main` and a `pushed` branch, as file:// so `--depth` is honored.
export function remoteWithMain(): string {
  const root = mkdtempSync(join(tmpdir(), 'knecht-remote-'))
  const work = join(root, 'work')
  const bare = join(root, 'origin.git')
  execFileSync('git', ['init', '-q', '-b', 'main', work])
  git(work, 'config', 'user.email', 'test@knecht.test')
  git(work, 'config', 'user.name', 'test')
  writeFileSync(join(work, 'README.md'), 'main\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'init')
  git(work, 'checkout', '-qb', 'pushed')
  writeFileSync(join(work, 'README.md'), 'pushed\n')
  git(work, 'commit', '-qam', 'pushed')
  execFileSync('git', ['clone', '-q', '--bare', work, bare])
  return `file://${bare}`
}

export function credentialsFor(cloneUrl: string) {
  return { cloneUrl, username: 'x-access-token', token: 'secret-token' }
}
