import type { Octokit } from 'octokit'
import { describe, expect, it } from 'vitest'
import { fetchDdevConfig } from '../../server/utils/github'

// The connect path must tell "no .ddev/config.yaml" (null) from "there is
// one, it just does not parse" (empty shape): only the former is a repo
// Knecht generates an environment for.
function octokitWith(file: string | null): Octokit {
  return {
    rest: {
      repos: {
        getContent: async () => {
          if (file === null) throw Object.assign(new Error('Not Found'), { status: 404 })
          return { data: { type: 'file', content: Buffer.from(file).toString('base64') } }
        },
      },
    },
  } as unknown as Octokit
}

describe('fetchDdevConfig', () => {
  it('is null for a missing file', async () => {
    expect(await fetchDdevConfig(octokitWith(null), 'o', 'r')).toBeNull()
  })

  it('parses a tracked config', async () => {
    const cfg = await fetchDdevConfig(octokitWith('name: demo\ntype: craftcms\nphp_version: "8.3"'), 'o', 'r')
    expect(cfg).toMatchObject({ type: 'craftcms', phpVersion: '8.3', hosts: ['demo.ddev.site'] })
  })

  it('keeps an unparseable file distinguishable from a missing one', async () => {
    const cfg = await fetchDdevConfig(octokitWith('name: ['), 'o', 'r')
    expect(cfg).not.toBeNull()
    expect(cfg).toMatchObject({ type: null, webserver: 'nginx-fpm', hosts: [] })
  })

  it('rethrows anything but a 404', async () => {
    const getContent = async () => {
      throw Object.assign(new Error('rate limited'), { status: 403 })
    }
    const octokit = { rest: { repos: { getContent } } } as unknown as Octokit
    await expect(fetchDdevConfig(octokit, 'o', 'r')).rejects.toThrow('rate limited')
  })
})
