import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { parse } from 'yaml'
import { DDEV_DEFAULT_NODE, DDEV_DEFAULT_PHP, DDEV_PHP_VERSIONS, NODE_LTS_MAJORS, PACKAGE_MANAGERS, type DetectedEnv, type EnvSource, type PackageManagerName, type ResolvedFields } from '../../shared/utils/env-spec'

// Derive a project's environment spec (shared/utils/env-spec.ts) from the
// files it commonly ships (ENV_DETECT_FILES). Pure: the caller supplies
// `readFile` (the session checkout at boot, the GitHub contents API at
// connect time), so detection runs identically in both places and in tests.
// A detector never throws: anything unparseable becomes "nothing found" plus
// one warning line for the run log. Deliberately small (v1): the framework
// itself (composer.lock) stays with utils/github.ts and the project card.
// For node, the first file with a value wins, in ENV_DETECT_FILES order.

// A repo file's text, or null when the file does not exist. Anything else
// (unreadable, an API failure) throws: a permission problem must not pass as
// "the repo has no composer.json".
export type ReadFile = (path: string) => string | null

export type EnvFile = Exclude<EnvSource, 'default' | 'setting'>

// Every file detection may read: the connect-time path fetches exactly these.
export const ENV_DETECT_FILES: EnvFile[] = [
  '.ddev/config.yaml',
  'composer.json',
  'mise.toml',
  '.mise.toml',
  '.tool-versions',
  '.nvmrc',
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
]

// First line of a `.ddev/config.yaml` Knecht wrote itself (daemon/ddev.ts).
// A repo config starting with it is Knecht's own from an earlier boot of the
// same checkout, not the project's.
export const GENERATED_MARKER = '#knecht-generated'

// Whether a `.ddev/config.yaml` text (null: no file) is the repo's own, as
// opposed to missing or one Knecht generated on an earlier boot.
export function repoShipsDdevConfig(text: string | null): text is string {
  return text !== null && !text.startsWith(GENERATED_MARKER)
}

// A `readFile` over a local checkout.
export function checkoutReader(dir: string): ReadFile {
  return (path) => {
    try {
      return readFileSync(join(dir, path), 'utf8')
    }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw e
    }
  }
}

export function detectEnv(readFile: ReadFile): DetectedEnv {
  const warnings: string[] = []
  const fields: Partial<ResolvedFields> = {}

  // The repo's package manager, whoever provides the ddev config: the boot
  // points its store at the host cache (daemon/ddev.ts) for every project.
  const pm = detectPackageManager(readFile, warnings)
  if (pm) fields.packageManager = pm

  const ddev = readFile('.ddev/config.yaml')
  if (repoShipsDdevConfig(ddev)) {
    // The repo's own config: Knecht never writes over a file it did not
    // generate, so even one it cannot read keeps the project a ddev one.
    const cfg = parseDdevConfig(ddev)
    if (!cfg) {
      warnings.push('.ddev/config.yaml could not be parsed; ddev may refuse to start')
      // ddev's own default: a db container unless omitted.
      fields.hasDb = { value: true, source: '.ddev/config.yaml' }
      return { source: 'ddev', fields, warnings }
    }
    fields.hasDb = { value: cfg.hasDb, source: '.ddev/config.yaml' }
    fields.hosts = { value: cfg.hosts, source: '.ddev/config.yaml' }
    if (cfg.phpVersion) fields.phpVersion = { value: cfg.phpVersion, source: '.ddev/config.yaml' }
    if (cfg.nodeVersion) fields.nodeVersion = { value: cfg.nodeVersion, source: '.ddev/config.yaml' }
    return { source: 'ddev', fields, warnings }
  }

  const php = detectPhp(readFile, warnings)
  if (php) fields.phpVersion = php
  const node = detectNode(readFile, warnings)
  if (node) fields.nodeVersion = node
  return { source: 'generated', fields, warnings }
}

// ── .ddev/config.yaml ──────────────────────────────────────────────────────

export interface DdevConfigFile {
  generated: boolean // written by Knecht (GENERATED_MARKER), not the repo's own
  type: string | null // the ddev project type, i.e. the framework ('craftcms')
  webserver: string // webserver_type; ddev's default when omitted
  hosts: string[] // primary `<name>.<tld>` first, then additional_hostnames/additional_fqdns
  hasDb: boolean // no `db` in omit_containers
  dbType: string | null
  dbVersion: string | null
  phpVersion: string | null
  nodeVersion: string | null
}

// THE parser for `.ddev/config.yaml`, tracked or generated, wherever the text
// came from (checkout, GitHub). Null when the YAML does not parse or is not
// a mapping. Fields ddev defaults when omitted stay null, except the
// webserver (nginx-fpm), the one default Knecht relies on.
export function parseDdevConfig(text: string): DdevConfigFile | null {
  let cfg: {
    name?: string
    type?: string
    webserver_type?: string
    project_tld?: string
    additional_hostnames?: string[]
    additional_fqdns?: string[]
    omit_containers?: string[]
    php_version?: string | number
    nodejs_version?: string | number
    database?: { type?: string, version?: string | number }
  } | null
  try {
    cfg = parse(text)
  }
  catch {
    return null
  }
  if (!cfg || typeof cfg !== 'object') return null
  const tld = cfg.project_tld || 'ddev.site'
  const hosts = cfg.name
    ? [
        `${cfg.name}.${tld}`,
        ...(Array.isArray(cfg.additional_hostnames) ? cfg.additional_hostnames : []).map(h => `${h}.${tld}`),
        ...(Array.isArray(cfg.additional_fqdns) ? cfg.additional_fqdns : []),
      ]
    : []
  return {
    generated: text.startsWith(GENERATED_MARKER),
    type: cfg.type ?? null,
    webserver: cfg.webserver_type ?? 'nginx-fpm',
    hosts,
    hasDb: !(Array.isArray(cfg.omit_containers) && cfg.omit_containers.includes('db')),
    dbType: cfg.database?.type ?? null,
    dbVersion: str(cfg.database?.version),
    phpVersion: str(cfg.php_version),
    nodeVersion: str(cfg.nodejs_version),
  }
}

const str = (v: unknown): string | null => (v == null ? null : String(v))

// ── PHP ────────────────────────────────────────────────────────────────────

function detectPhp(readFile: ReadFile, warnings: string[]): ResolvedFields['phpVersion'] | null {
  const text = readFile('composer.json')
  if (text === null) return null
  let constraint: unknown
  try {
    constraint = (JSON.parse(text) as { require?: Record<string, unknown> }).require?.php
  }
  catch {
    warnings.push(`composer.json could not be parsed, using PHP ${DDEV_DEFAULT_PHP}`)
    return null
  }
  if (typeof constraint !== 'string' || !constraint.trim()) return null
  const version = normalizePhpConstraint(constraint)
  if (!version) {
    warnings.push(`composer.json requires php '${constraint}', which no ddev PHP version satisfies, using PHP ${DDEV_DEFAULT_PHP}`)
    return null
  }
  return { value: version, source: 'composer.json' }
}

// The highest ddev PHP version satisfying a Composer constraint, or null when
// none does (or the constraint is unreadable). Composer's syntax is not npm
// semver, so it is translated first:
//   ~8.1        Composer: >=8.1 <9.0 (npm: >=8.1.0 <8.2.0), so two-part tilde
//               becomes caret
//   >=8.1,<8.3  comma is AND in Composer, invalid for npm: becomes a space
//   ^7.4|^8.0   single pipe is OR in Composer: becomes ||
// `^8.1`, `8.2.*`, `>=8.1 <8.3` and three-part `~8.1.0` mean the same in both.
export function normalizePhpConstraint(constraint: string): string | null {
  const range = constraint
    .trim()
    .replace(/\|+/g, ' || ')
    .replace(/,/g, ' ')
    .replace(/~(\d+\.\d+)(?![.\d])/g, '^$1')
  if (!semver.validRange(range)) return null
  const best = semver.maxSatisfying(DDEV_PHP_VERSIONS.map(v => `${v}.0`), range)
  return best ? best.replace(/\.0$/, '') : null
}

// ── Node ───────────────────────────────────────────────────────────────────

// nvm's LTS code names (`.nvmrc`: lts/iron).
const NODE_LTS_NAMES: Record<string, string> = {
  hydrogen: '18',
  iron: '20',
  jod: '22',
  krypton: '24',
}

function detectNode(readFile: ReadFile, warnings: string[]): ResolvedFields['nodeVersion'] | null {
  const candidates: { source: EnvSource, read: (text: string) => string | null }[] = [
    { source: 'mise.toml', read: miseNode },
    { source: '.mise.toml', read: miseNode },
    { source: '.tool-versions', read: toolVersionsNode },
    { source: '.nvmrc', read: t => t.trim() },
    { source: 'package.json', read: enginesNode },
  ]
  for (const { source, read } of candidates) {
    const text = readFile(source)
    if (text === null) continue
    let raw: string | null
    try {
      raw = read(text)
    }
    catch {
      warnings.push(`${source} could not be parsed, using Node ${DDEV_DEFAULT_NODE}`)
      continue
    }
    if (!raw) continue
    const version = source === 'package.json' ? normalizeNodeConstraint(raw) : normalizeNodeVersion(raw)
    if (!version) {
      warnings.push(`${source} names Node '${raw}', which Knecht cannot pin, using Node ${DDEV_DEFAULT_NODE}`)
      return null
    }
    return { value: version, source }
  }
  return null
}

// `[tools] node = "22"` (or `nodejs`) out of a mise config. A tiny line
// scanner instead of a TOML parser: this is the only key Knecht reads.
function miseNode(text: string): string | null {
  let inTools = false
  for (const line of text.split('\n')) {
    const section = /^\s*\[([^\]]+)\]/.exec(line)
    if (section) {
      inTools = section[1]!.trim() === 'tools'
      continue
    }
    if (!inTools) continue
    const m = /^\s*(?:node|nodejs)\s*=\s*"([^"]*)"/.exec(line)
    if (m) return m[1]!
  }
  return null
}

// asdf/mise `.tool-versions`: `nodejs 22.4.0` (mise also accepts `node`).
function toolVersionsNode(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^\s*(?:nodejs|node)\s+(\S+)/.exec(line)
    if (m) return m[1]!
  }
  return null
}

function enginesNode(text: string): string | null {
  const node = (JSON.parse(text) as { engines?: { node?: unknown } }).engines?.node
  return typeof node === 'string' && node.trim() ? node.trim() : null
}

// A literal Node version as ddev's `nodejs_version` wants it: `20`, `v20.11`,
// `22.4.0` become `20`, `20.11`, `22.4` (major.minor at most: that is what
// people pin, and it keeps ddev's `n` install predictable). nvm code names
// map to their major; `lts/*`, `latest`, `node` and the like are moving
// targets Knecht does not chase (null, so the default applies).
export function normalizeNodeVersion(raw: string): string | null {
  const value = raw.trim()
  const lts = /^lts\/([a-z]+)$/i.exec(value)
  if (lts) return NODE_LTS_NAMES[lts[1]!.toLowerCase()] ?? null
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(value)
  if (!m) return null
  return m[2] === undefined ? m[1]! : `${m[1]}.${m[2]}`
}

// `engines.node` is a range (`>=20`, `^22.0.0`, `20.x`): the ddev default
// when it satisfies the range (the stable fallback stays the fallback), else
// the highest LTS major (NODE_LTS_MAJORS) that does.
export function normalizeNodeConstraint(constraint: string): string | null {
  if (!semver.validRange(constraint)) return null
  if (semver.satisfies(`${DDEV_DEFAULT_NODE}.0.0`, constraint)) return DDEV_DEFAULT_NODE
  const best = semver.maxSatisfying(NODE_LTS_MAJORS.map(v => `${v}.0.0`), constraint)
  return best ? best.split('.')[0]! : null
}

// ── Package manager ────────────────────────────────────────────────────────

// The lockfiles that name a package manager by their presence, in the order
// the first one wins.
const LOCKFILES: { source: EnvSource, name: PackageManagerName }[] = [
  { source: 'pnpm-lock.yaml', name: 'pnpm' },
  { source: 'yarn.lock', name: 'yarn' },
  { source: 'bun.lock', name: 'bun' },
  { source: 'bun.lockb', name: 'bun' },
  { source: 'package-lock.json', name: 'npm' },
]

// The Corepack `packageManager` field (`pnpm@9.1.0`, Corepack itself appends
// `+sha512.<hash>`, which is dropped) wins because it pins the version;
// otherwise the lockfile says which manager wrote it. A version that is not
// a plain semver never reaches the bun Dockerfile: the name stays, the
// version does not.
function detectPackageManager(readFile: ReadFile, warnings: string[]): ResolvedFields['packageManager'] | null {
  const pkg = readFile('package.json')
  if (pkg !== null) {
    let field: unknown
    try {
      field = (JSON.parse(pkg) as { packageManager?: unknown }).packageManager
    }
    catch {
      warnings.push('package.json could not be parsed, using npm')
      field = undefined
    }
    if (typeof field === 'string' && field.trim()) {
      const [name, spec] = field.trim().split('@')
      if (!isPackageManager(name)) {
        warnings.push(`package.json names package manager '${field}', which Knecht does not know, using npm`)
        return null
      }
      let version = spec?.split('+')[0] || null
      if (version && !semver.valid(version)) {
        warnings.push(`package.json pins ${name} to '${spec}', which is not a version, using ${name} without a pin`)
        version = null
      }
      return { value: { name, version }, source: 'package.json' }
    }
  }
  for (const { source, name } of LOCKFILES) {
    if (readFile(source) !== null) return { value: { name, version: null }, source }
  }
  return null
}

const isPackageManager = (name: string | undefined): name is PackageManagerName =>
  PACKAGE_MANAGERS.includes(name as PackageManagerName)
