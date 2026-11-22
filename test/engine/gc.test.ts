import { describe, expect, it } from 'vitest'

const { staleBuilders, staleImages, staleReleaseImages, staleSessionVolumes } = await import('#server/daemon/gc')

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

  it('drops a live session\'s image built by another ddev version', () => {
    expect(staleImages([
      'ddev/ddev-webserver:v1.25.4-knecht-run-216-built',
      'ddev/ddev-webserver:v1.25.5-knecht-run-216-built',
    ], keep)).toEqual(['ddev/ddev-webserver:v1.25.4-knecht-run-216-built'])
  })
})

describe('staleReleaseImages', () => {
  it('drops the releases older than the running one', () => {
    expect(staleReleaseImages([
      'ghcr.io/knecht-works/knecht-cloud:v0.20.1',
      'ghcr.io/knecht-works/knecht-cloud:v0.21.0',
      'ghcr.io/knecht-works/knecht-cloud:v0.22.0',
      'ghcr.io/knecht-works/knecht-cloud:latest',
      'caddy:2-alpine',
    ], 'v0.21.0')).toEqual(['ghcr.io/knecht-works/knecht-cloud:v0.20.1'])
  })

  it('keeps every release when the running version is no release', () => {
    expect(staleReleaseImages(['ghcr.io/knecht-works/knecht-cloud:v0.20.1'], 'dev')).toEqual([])
  })
})

describe('staleSessionVolumes', () => {
  it('drops the volumes of sessions without a stack and keeps the others', () => {
    expect(staleSessionVolumes([
      'knecht-run-216-mariadb\tddev-knecht-run-216',
      'knecht-run-214-mariadb\tddev-knecht-run-214',
      'ddev-knecht-run-214-web-cache\tddev-knecht-run-214',
      'knecht-base-3-abc-mariadb\tddev-knecht-base-3-abc',
      'knecht-cloud_nuxt\tknecht-cloud',
      'ddev-global-cache\t',
    ], id => id === 216)).toEqual(['knecht-run-214-mariadb', 'ddev-knecht-run-214-web-cache'])
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
