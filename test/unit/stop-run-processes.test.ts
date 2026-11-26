import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as string[][])
vi.mock('execa', async importOriginal => ({
  ...await importOriginal<typeof import('execa')>(),
  execa: vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args)
    return { exitCode: 0, stdout: '' }
  }),
}))

const { STOP_TAGGED_SCRIPT, runTag } = await import('#server/daemon/sandbox')
const { stopRunProcesses } = await import('#server/daemon/session-sandbox')

// A killed process stays a zombie until its parent reaps it.
function alive(pid: number): boolean {
  try {
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  }
  catch {
    return false
  }
}

describe('stopRunProcesses', () => {
  it('runs the stop script as the user of the run\'s commands in both session containers', async () => {
    calls.length = 0
    expect(await stopRunProcesses(7, 42)).toBe(true)
    expect(calls).toHaveLength(2)
    for (const args of calls) {
      expect(args.slice(0, 3)).toEqual(['exec', '-u', `${process.getuid!()}:${process.getgid!()}`])
      expect(args.slice(-2)).toEqual(['knecht-stop', `${Object.keys(runTag(42))[0]}=42`])
    }
    expect(calls.map(a => a[3])).toEqual(['ddev-knecht-run-7-web', 'knecht-run-7-workspace'])
  })

  // Reads /proc, so only where the containers' kernel does.
  it.skipIf(process.platform !== 'linux')('kills every process carrying the run tag, also a detached grandchild, and nothing else', async () => {
    const tagged = spawn('sh', ['-c', 'setsid sleep 60 & echo $!; sleep 60'], { env: { ...process.env, ...runTag(42) }, stdio: ['ignore', 'pipe', 'ignore'] })
    const other = spawn('sleep', ['60'], { env: { ...process.env, ...runTag(43) }, stdio: 'ignore' })
    const grandchild = Number(await new Promise<string>(resolve => tagged.stdout!.once('data', d => resolve(String(d).trim()))))
    await sleep(100)

    const stop = spawn('sh', ['-c', STOP_TAGGED_SCRIPT, 'knecht-stop', `${Object.keys(runTag(42))[0]}=42`], { stdio: 'ignore' })
    const code = await new Promise<number | null>(resolve => stop.on('exit', resolve))

    expect(code).toBe(0)
    expect(alive(grandchild)).toBe(false)
    expect(alive(tagged.pid!)).toBe(false)
    expect(alive(other.pid!)).toBe(true)
    other.kill('SIGKILL')
  })
})
