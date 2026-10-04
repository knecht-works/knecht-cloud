import { describe, expect, it } from 'vitest'
import { parseExposeEnv } from '../../server/daemon/sandbox'
import { nameServices } from '../../server/utils/session-services'

const web = (port: number) => ({ service: 'web', container: 'ddev-knecht-run-7-web', port })
const none = { hosts: [], previewPort: null, extraPorts: [] }

describe('parseExposeEnv', () => {
  it('collects the container ports of both expose variables once each', () => {
    const env = 'TZ=UTC\nHTTP_EXPOSE=80:80,8025:8025,2999:3000\nHTTPS_EXPOSE=443:80,8026:8025,3000:3000\n'
    expect(parseExposeEnv(env).sort((a, b) => a - b)).toEqual([80, 3000, 8025])
  })

  it('finds nothing in a container that exposes nothing', () => {
    expect(parseExposeEnv('TZ=UTC\n')).toEqual([])
  })
})

describe('nameServices', () => {
  it('names Mailpit and skips the preview port', () => {
    expect(nameServices([web(80), web(8025)], none)).toEqual([{ label: 'mailpit', container: 'ddev-knecht-run-7-web', port: 8025 }])
  })

  it('names extra web ports after the project config and leaves out the dev server port', () => {
    const services = nameServices([web(3000), web(6006), web(9000)], { ...none, previewPort: 3000, extraPorts: [{ name: 'Story_Book', port: 6006 }] })
    expect(services.map(s => s.label)).toEqual(['story-book', 'web-9000'])
  })

  it('names add-on containers after their service, and further ports of the same container by port', () => {
    const solr = { service: 'solr', container: 'ddev-knecht-run-7-solr' }
    expect(nameServices([{ ...solr, port: 8983 }, { ...solr, port: 9000 }], none).map(s => s.label)).toEqual(['solr', 'solr-9000'])
  })

  it('never takes a label that a project hostname or the IDE already owns', () => {
    const exposed = [{ service: 'ide', container: 'c-ide', port: 1 }, { service: 'cp', container: 'c-cp', port: 2 }, web(8025)]
    expect(nameServices(exposed, { ...none, hosts: ['demo.ddev.site', 'cp.ddev.site', 'mailpit.ddev.site'] })).toEqual([])
  })
})
