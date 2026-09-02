import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkoutReader, detectEnv, normalizeNodeConstraint, normalizeNodeVersion, normalizePhpConstraint, parseDdevConfig, repoShipsDdevConfig } from '../../server/utils/env-detect'

// Each fixture folder is one repo shape; the reader is the real checkout one.
const fixture = (name: string) => checkoutReader(join(__dirname, '..', 'fixtures', 'env-detect', name))

describe('detectEnv', () => {
  it('finds nothing in an empty repo: generated, defaults, no warnings', () => {
    expect(detectEnv(fixture('empty'))).toEqual({ source: 'generated', fields: {}, warnings: [] })
  })

  describe('composer.json require.php', () => {
    it.each([
      ['composer-caret', '^8.1', '8.4'],
      ['composer-range', '>=8.1 <8.3', '8.2'],
      ['composer-exact', '8.2.*', '8.2'],
      ['composer-tilde', '~8.1', '8.4'],
      ['composer-comma', '>=8.1,<8.3', '8.2'],
    ])('%s: %s resolves to the highest matching ddev PHP %s', (dir, _constraint, expected) => {
      const { source, fields, warnings } = detectEnv(fixture(dir))
      expect(source).toBe('generated')
      expect(fields.phpVersion).toEqual({ value: expected, source: 'composer.json' })
      expect(warnings).toEqual([])
    })

    it('leaves the default with a warning when no ddev PHP satisfies the constraint', () => {
      const { fields, warnings } = detectEnv(fixture('composer-unknown'))
      expect(fields.phpVersion).toBeUndefined()
      expect(warnings).toEqual([expect.stringContaining('>=9')])
    })

    it('never throws on broken JSON: default plus warning', () => {
      const { fields, warnings } = detectEnv(fixture('composer-broken-json'))
      expect(fields.phpVersion).toBeUndefined()
      expect(warnings).toEqual([expect.stringContaining('composer.json could not be parsed')])
    })
  })

  describe('node version files', () => {
    it('reads a plain .nvmrc', () => {
      expect(detectEnv(fixture('nvmrc-plain')).fields.nodeVersion).toEqual({ value: '20', source: '.nvmrc' })
    })

    it('treats lts/* as unpinnable: default plus warning', () => {
      const { fields, warnings } = detectEnv(fixture('nvmrc-lts-star'))
      expect(fields.nodeVersion).toBeUndefined()
      expect(warnings).toEqual([expect.stringContaining('lts/*')])
    })

    it('resolves engines.node >=20 to the ddev default', () => {
      expect(detectEnv(fixture('engines-node')).fields.nodeVersion).toEqual({ value: '22', source: 'package.json' })
    })

    it('reads [tools] node from mise.toml', () => {
      expect(detectEnv(fixture('mise-toml')).fields.nodeVersion).toEqual({ value: '22', source: 'mise.toml' })
    })

    it('shortens .tool-versions nodejs to major.minor', () => {
      expect(detectEnv(fixture('tool-versions')).fields.nodeVersion).toEqual({ value: '22.4', source: '.tool-versions' })
    })

    it('lets mise.toml win over .nvmrc', () => {
      expect(detectEnv(fixture('node-priority')).fields.nodeVersion).toEqual({ value: '22', source: 'mise.toml' })
    })
  })

  describe('.ddev/config.yaml', () => {
    it('a tracked config makes the project a ddev one: hosts, database, versions from the file', () => {
      const { source, fields, warnings } = detectEnv(fixture('ddev-tracked'))
      expect(source).toBe('ddev')
      expect(fields.hosts).toEqual({ value: ['demo.ddev.site', 'alpha.ddev.site', 'www.example.com'], source: '.ddev/config.yaml' })
      expect(fields.hasDb).toEqual({ value: true, source: '.ddev/config.yaml' })
      expect(fields.phpVersion).toEqual({ value: '8.3', source: '.ddev/config.yaml' })
      expect(fields.nodeVersion).toEqual({ value: '20', source: '.ddev/config.yaml' })
      expect(warnings).toEqual([])
    })

    it('a config Knecht generated earlier does not count as the repo\'s own', () => {
      const { source, fields } = detectEnv(fixture('ddev-generated-marker'))
      expect(source).toBe('generated')
      expect(fields.hosts).toBeUndefined()
      expect(fields.phpVersion).toEqual({ value: '8.2', source: 'composer.json' })
    })

    it('reads omit_containers for hasDb', () => {
      const read = (path: string) => path === '.ddev/config.yaml' ? 'name: demo\nomit_containers: [db, dba]\n' : null
      expect(detectEnv(read).fields.hasDb).toEqual({ value: false, source: '.ddev/config.yaml' })
    })

    it('keeps an unparseable tracked config a ddev project, with a warning and nothing else', () => {
      const { source, fields, warnings } = detectEnv(fixture('ddev-broken'))
      expect(source).toBe('ddev')
      expect(fields).toEqual({})
      expect(warnings).toEqual([expect.stringContaining('.ddev/config.yaml could not be parsed')])
    })
  })
})

describe('checkoutReader', () => {
  it('reports a missing file as null and rethrows everything else', () => {
    const read = checkoutReader(join(__dirname, '..', 'fixtures', 'env-detect'))
    expect(read('nope/composer.json')).toBeNull()
    // `empty/README.md` is a file, so a path below it is ENOTDIR: missing too.
    expect(read('empty/README.md/x')).toBeNull()
    // A directory is not a readable file: that is an error, not "missing".
    expect(() => read('empty')).toThrow()
  })
})

describe('parseDdevConfig', () => {
  it('honors a custom project_tld', () => {
    expect(parseDdevConfig('name: demo\nproject_tld: test\nadditional_hostnames: [alpha]')?.hosts)
      .toEqual(['demo.test', 'alpha.test'])
  })

  it('serves no host without a name, and is null when the YAML does not parse', () => {
    expect(parseDdevConfig('webserver_type: nginx-fpm')?.hosts).toEqual([])
    expect(parseDdevConfig('name: [')).toBeNull()
    expect(parseDdevConfig('')).toBeNull()
    expect(parseDdevConfig('just a string')).toBeNull()
  })

  it('reads the framework facts the project card needs, versions as strings', () => {
    const cfg = parseDdevConfig('name: demo\ntype: craftcms\nphp_version: 8.1\nnodejs_version: 20\ndatabase: { type: mariadb, version: 10.11 }')
    expect(cfg).toMatchObject({ type: 'craftcms', webserver: 'nginx-fpm', phpVersion: '8.1', nodeVersion: '20', dbType: 'mariadb', dbVersion: '10.11', generated: false })
  })
})

describe('normalizePhpConstraint', () => {
  it.each([
    ['^8.1', '8.4'],
    ['~8.1', '8.4'],
    ['~8.1.0', '8.1'],
    ['>=8.1 <8.3', '8.2'],
    ['>=8.1,<8.3', '8.2'],
    ['>= 8.1', '8.4'],
    ['8.2.*', '8.2'],
    ['^7.4|^8.0', '8.4'],
    ['^7.4 || ^8.0', '8.4'],
    ['~7.4', '7.4'],
    ['*', '8.4'],
  ])('%s → %s', (constraint, expected) => {
    expect(normalizePhpConstraint(constraint)).toBe(expected)
  })

  it('returns null for constraints nothing satisfies or that do not parse', () => {
    expect(normalizePhpConstraint('>=9')).toBeNull()
    expect(normalizePhpConstraint('php-8')).toBeNull()
  })
})

describe('normalizeNodeVersion', () => {
  it.each([
    ['20', '20'],
    ['v20.11', '20.11'],
    ['v20.11.1', '20.11'],
    ['22.4.0', '22.4'],
    ['lts/iron', '20'],
    ['lts/Jod', '22'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeNodeVersion(raw)).toBe(expected)
  })

  it('refuses moving targets and unknown names', () => {
    for (const raw of ['lts/*', 'latest', 'node', 'lts/unobtainium', '']) {
      expect(normalizeNodeVersion(raw)).toBeNull()
    }
  })
})

describe('normalizeNodeConstraint', () => {
  it('prefers the ddev default when it satisfies the range', () => {
    expect(normalizeNodeConstraint('>=20')).toBe('22')
    expect(normalizeNodeConstraint('^22.0.0')).toBe('22')
    expect(normalizeNodeConstraint('>=18 <23')).toBe('22')
  })

  it('otherwise picks the highest known LTS that does', () => {
    expect(normalizeNodeConstraint('^20')).toBe('20')
    expect(normalizeNodeConstraint('20.x')).toBe('20')
    expect(normalizeNodeConstraint('>=24')).toBe('24')
  })

  it('returns null when no known LTS satisfies the range or it does not parse', () => {
    expect(normalizeNodeConstraint('>=26')).toBeNull()
    expect(normalizeNodeConstraint('node-22')).toBeNull()
  })
})

describe('repoShipsDdevConfig', () => {
  it('is true only for a config the repo tracks itself', () => {
    expect(repoShipsDdevConfig(null)).toBe(false)
    expect(repoShipsDdevConfig('#knecht-generated\nname: x')).toBe(false)
    expect(repoShipsDdevConfig('name: demo')).toBe(true)
  })
})
