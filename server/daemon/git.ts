import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import type { Project } from '../db/schema'
import { KNECHT_COMPOSE_FILE, KNECHT_CONFIG_FILE } from './ddev'
import { bridgeBaseUrl, bridgeToken } from '../utils/agent-bridge'
import { checkoutReader, repoShipsDdevConfig } from '../utils/env-detect'
import { getBotIdentity } from '../utils/github-app'
import { normalizeSharedFolder, sessionCheckoutDir } from '../utils/storage'

// A clone, not a worktree: a worktree's .git pointer would dangle inside the
// bind-mounted web container. The token travels as a per-operation header,
// never in the remote URL or the run log.
export async function prepareSessionCheckout(
  project: Project,
  sessionId: number,
  token: string,
  onLog: (line: string) => void,
  branch: string = project.defaultBranch,
): Promise<string> {
  const dir = sessionCheckoutDir(sessionId)
  const url = `https://github.com/${project.fullName}.git`

  try {
    if (existsSync(join(dir, '.git'))) {
      onLog(`Reusing checkout at ${dir}\n`)
    }
    else {
      onLog(`Cloning ${project.fullName} (${branch})…\n`)
      await git([...authFlags(token), 'clone', '--depth', '1', '--branch', branch, url, dir])
    }

    shieldGeneratedFiles(dir, project.sharedFolders)
    await configureCheckout(dir, sessionId)
    return dir
  }
  catch (e) {
    // The run log is UI-visible.
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

async function configureCheckout(dir: string, sessionId: number): Promise<void> {
  const identity = (await getBotIdentity()) ?? FALLBACK_IDENTITY
  await git(['-C', dir, 'config', 'user.name', identity.name])
  await git(['-C', dir, 'config', 'user.email', identity.email])
  await git(['-C', dir, 'config', 'push.autoSetupRemote', 'true'])
  const base = await bridgeBaseUrl()
  if (!base) return
  const env = `KNECHT_BRIDGE_URL=${base}/agent-bridge KNECHT_BRIDGE_TOKEN=${bridgeToken(sessionId)} KNECHT_RUN_ID=${sessionId}`
  await git(['-C', dir, 'config', 'credential.helper', `!${env} knecht-git credential`])
}

function authFlags(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${basic}`]
}

export async function createBranch(dir: string, name: string): Promise<void> {
  await git(['-C', dir, 'checkout', '-b', name])
}

// The agent creates branches with plain git, so a DB-tracked branch would go stale.
export async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await git(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  return stdout.trim()
}

export interface CommitIdentity { name: string, email: string }
// Not users.noreply.github.com: knecht@... there belongs to an unrelated real account.
const FALLBACK_IDENTITY: CommitIdentity = { name: 'Knecht', email: 'noreply@knecht.works' }

export async function commitAll(
  dir: string,
  message: string,
  opts?: { identity?: CommitIdentity | null, paths?: string[] },
): Promise<string | null> {
  if (opts?.paths?.length) await git(['-C', dir, 'add', '--', ...opts.paths])
  else await git(['-C', dir, 'add', '-A'])
  const { stdout: staged } = await git(['-C', dir, 'diff', '--cached', '--name-only'])
  if (!staged.trim()) return null
  const identity = opts?.identity ?? FALLBACK_IDENTITY
  await git([
    '-C', dir,
    '-c', `user.name=${identity.name}`,
    '-c', `user.email=${identity.email}`,
    'commit', '-m', message,
  ])
  const { stdout } = await git(['-C', dir, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  const { stdout } = await git(['-C', dir, 'status', '--porcelain'])
  return Boolean(stdout.trim())
}

export async function pushBranch(dir: string, branch: string, token: string): Promise<void> {
  try {
    await git(['-C', dir, ...authFlags(token), 'push', 'origin', `HEAD:refs/heads/${branch}`])
  }
  catch (e) {
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

// The generated ddev config carries secrets and the git actions run `git add -A`,
// so these go into info/exclude. ddev drops more files into a generated .ddev/ on start.
function shieldGeneratedFiles(dir: string, sharedFolders: string[]): void {
  const exclude = join(dir, '.git', 'info', 'exclude')
  const patterns = [
    ...(repoShipsDdevConfig(checkoutReader(dir)('.ddev/config.yaml'))
      ? [`/.ddev/${KNECHT_CONFIG_FILE}`, `/.ddev/${KNECHT_COMPOSE_FILE}`, '/.ddev/mysql/00-knecht-lowmem.cnf']
      : ['/.ddev/']),
    '/.knecht/',
    ...sharedFolders.map(normalizeSharedFolder).filter(p => p !== null).map(p => `/${p}/`),
  ]
  try {
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    const lines = current.split('\n')
    const missing = patterns.filter(p => !lines.includes(p))
    if (!missing.length) return
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`)
  }
  catch {
    // Best-effort.
  }
}

function git(args: string[]) {
  return execa('git', args)
}

function redact(text: string, token: string): string {
  if (!token) return text
  // git may echo either the raw token or its base64 header form in an error.
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return text.split(token).join('***').split(basic).join('***')
}
