import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Run as a plain CommonJS script outside the repo, whose package.json says "type: module".

const listenPort = 41500 + Math.floor(Math.random() * 400)
const targetPort = listenPort + 1
let forwarder: ChildProcess
let app: Server | null = null
let tlsDir: string

function startApp(protocol: 'http' | 'https' = 'http'): Promise<void> {
  const handler = (req: { url?: string }, res: { end: (body: string) => void }) => res.end(`hello ${req.url}`)
  app = protocol === 'https'
    ? createTlsServer({ key: readFileSync(join(tlsDir, 'key.pem')), cert: readFileSync(join(tlsDir, 'cert.pem')) }, handler)
    : createServer(handler)
  return new Promise(resolve => app!.listen(targetPort, '127.0.0.1', resolve))
}

async function stopApp(): Promise<void> {
  const closed = new Promise<void>(resolve => app!.close(() => resolve()))
  app!.closeAllConnections()
  await closed
  app = null
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
  tlsDir = mkdtempSync(join(tmpdir(), 'knecht-forward-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem')], { stdio: 'ignore' })
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
    await stopApp()
    await expect(fetch(`http://127.0.0.1:${listenPort}/x`)).rejects.toThrow()
    await startApp()
    expect((await fetchThrough()).status).toBe(200)
  })

  it('speaks TLS to a dev server that only serves https, so the proxy can stay on plain http', async () => {
    await stopApp()
    await startApp('https')
    const res = await fetchThrough()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello /x')
  })

  it('follows a dev server that switches back to plain http', async () => {
    await stopApp()
    await startApp('http')
    expect(await (await fetchThrough()).text()).toBe('hello /x')
  })

  it('refuses to start without both ports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knecht-forward-'))
    const script = join(dir, 'knecht-forward')
    copyFileSync(join(__dirname, '..', '..', 'sandbox', 'knecht-forward'), script)
    const code = await new Promise<number | null>(resolve => spawn(process.execPath, [script, '41000']).on('exit', resolve))
    expect(code).toBe(2)
  })
})
