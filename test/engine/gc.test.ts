import { describe, expect, it } from 'vitest'

const { staleBuilders, staleImages } = await import('#server/daemon/gc')

const keep = { ddevTag: 'v1.25.5', sessions: new Set([216]), building: (tag: string) => tag.includes('knecht-base-31-live') }

describe('staleImages', () => {
  it('drops the images of sessions without a stack and keeps the live ones', () => {
    expect(staleImages([
      'ddev/ddev-webserver:v1.25.5-knecht-run-216-built',
      'ddev/ddev-webserver:v1.25.5-knecht-run-214-built',
      'ddev/ddev-dbserver-mysql-8.0:v1.25.5-knecht-run-214-built',
    ], keep)).toEqual([
      'ddev/ddev-webserver:v1.25.5-knecht-run-214-built',
      'ddev/ddev-dbserver-mysql-8.0:v1.25.5-knecht-run-214-built',
    ])
  })

  it('drops a finished base builder and keeps a running one', () => {
    expect(staleImages([
      'ddev/ddev-webserver:v1.25.5-knecht-base-31-done-built',
      'ddev/ddev-webserver:v1.25.5-knecht-base-31-live-built',
    ], keep)).toEqual(['ddev/ddev-webserver:v1.25.5-knecht-base-31-done-built'])
  })

  it('drops the image set of another ddev version, the workspace image included', () => {
    expect(staleImages([
      'ddev/ddev-webserver:v1.25.2',
      'ddev/ddev-webserver:v1.25.2-cfx-probe-built',
      'knecht-workspace:v1.25.2-1000-1000',
      'ddev/ddev-webserver:v1.25.5',
      'ddev/ddev-webserver:v1.25.5-knecht-warmup-built',
      'knecht-workspace:v1.25.5-1000-1000',
      'ddev/ddev-webserver:v1.25.50',
    ], keep)).toEqual([
      'ddev/ddev-webserver:v1.25.2',
      'ddev/ddev-webserver:v1.25.2-cfx-probe-built',
      'knecht-workspace:v1.25.2-1000-1000',
      'ddev/ddev-webserver:v1.25.50',
    ])
  })

  it('leaves foreign and unversioned images alone, and every version when the current one is unknown', () => {
    expect(staleImages(['mariadb:10.6', 'ddev/ddev-utilities:latest', 'knecht-sandbox:latest'], keep)).toEqual([])
    expect(staleImages(['ddev/ddev-webserver:v1.25.2'], { ...keep, ddevTag: null })).toEqual([])
  })
})

describe('staleBuilders', () => {
  it('names each builder left behind once and keeps the running one', () => {
    expect(staleBuilders([
      'ddev-knecht-base-3-old-web',
      'ddev-knecht-base-3-old-db',
      'ddev-knecht-base-32-live-db',
      'ddev-knecht-run-216-web',
    ], name => name === 'knecht-base-32-live')).toEqual(['knecht-base-3-old'])
  })
})
