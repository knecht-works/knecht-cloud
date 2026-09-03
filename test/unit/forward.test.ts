import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// sandbox/knecht-forward, run the way the container runs it: as a plain
// CommonJS script outside the repo (whose package.json says "type: module").

const listenPort = 41500 + Math.floor(Math.random() * 400)
const targetPort = listenPort + 1
let forwarder: ChildProcess
let app: Server | null = null

function startApp(): Promise<void> {
  app = createServer((req, res) => res.end(`hello ${req.url}`))
  return new Promise(resolve => app!.listen(targetPort, '127.0.0.1', resolve))
}

async function fetchThrough(): Promise<Response> {
  for (let i = 0; i < 50; i++) {
    try {
      return await fetch(`http://127.0.0.1:${listenPort}/x`)
    }
    catch {
      await sleep(100)
    }
  }
  throw new Error('forwarder never answered')
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knecht-forward-'))
  const script = join(dir, 'knecht-forward')
  copyFileSync(join(__dirname, '..', '..', 'sandbox', 'knecht-forward'), script)
  forwarder = spawn(process.execPath, [script, String(listenPort), String(targetPort)], { stdio: 'inherit' })
  await startApp()
})

afterAll(() => {
  forwarder.kill()
  app?.close()
})

describe('knecht-forward', () => {
  it('forwards a request to a server bound on localhost only', async () => {
    const res = await fetchThrough()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello /x')
  })

  it('closes the connection while the target is down, so a poll keeps polling', async () => {
    await new Promise<void>(resolve => app!.close(() => resolve()))
    app = null
    await expect(fetch(`http://127.0.0.1:${listenPort}/x`)).rejects.toThrow()
    await startApp()
    expect((await fetchThrough()).status).toBe(200)
  })

  it('refuses to start without both ports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knecht-forward-'))
    const script = join(dir, 'knecht-forward')
    copyFileSync(join(__dirname, '..', '..', 'sandbox', 'knecht-forward'), script)
    const code = await new Promise<number | null>(resolve => spawn(process.execPath, [script, '41000']).on('exit', resolve))
    expect(code).toBe(2)
  })
})
