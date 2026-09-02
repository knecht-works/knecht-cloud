// The environment a session boots, described independently of where the
// facts came from. Knecht boots every project as a ddev project (the ONE
// substrate, daemon/ddev.ts); this spec is what the detection layer
// (server/utils/env-detect.ts) derives from the repo's files and what the
// project settings can override. Nothing here touches the filesystem, so the
// settings page resolves the same way the boot does.
//
// Two kinds of project:
//   'ddev'       the repo ships its own `.ddev/config.yaml`: it is the truth,
//                Knecht only reads along (hosts, database) and writes its
//                per-session overrides next to it. The overrides below are
//                ignored, the preview is served by the repo's web server.
//   'generated'  the repo has no ddev config (a library, a Nuxt module, a
//                Node project): Knecht writes one from this spec. Every field
//                starts at a stable default; detectors overwrite single
//                fields, settings overwrite detectors.

export type EnvKind = 'ddev' | 'generated'

// Where a resolved value came from: the setting, the file it was read from,
// or the default. Shown as-is in the run log and the settings card
// ("PHP 8.2 from composer.json").
export type EnvSource
  = | 'default'
    | 'setting'
    | '.ddev/config.yaml'
    | 'composer.json'
    | 'mise.toml'
    | '.mise.toml'
    | '.tool-versions'
    | '.nvmrc'
    | 'package.json'

export interface EnvSpec {
  phpVersion: string // ddev php_version, e.g. '8.2'
  nodeVersion: string // ddev nodejs_version: major or major.minor
  hasDb: boolean // whether the stack has a db container
  hosts: string[] // hostnames the repo's ddev config serves, primary first
  devServer: string | null // a command that serves the app, e.g. 'npm run dev' (generated only)
  previewPort: number | null // the port the dev server listens on; null = no preview
}

export interface ResolvedField<T> {
  value: T
  source: EnvSource
}

export type ResolvedFields = { [K in keyof EnvSpec]: ResolvedField<EnvSpec[K]> }

export interface ResolvedEnv extends ResolvedFields {
  source: EnvKind
}

// What detection yields: the kind, the fields it could derive (each with the
// file it came from) and one warning line per file it looked at but could not
// use (a broken composer.json, an unsupported constraint). Detection never
// fails: a missing field simply keeps its default.
export interface DetectedEnv {
  source: EnvKind
  fields: Partial<ResolvedFields>
  warnings: string[]
}

// The project-level overrides (projects.php_version and friends): null means
// "not overridden, use what was detected".
export interface EnvOverrides {
  phpVersion: string | null
  nodeVersion: string | null
  devServer: string | null
  previewPort: number | null
}

// ddev's own defaults and supported PHP list, pinned to the DDEV_VERSION the
// host runs (Dockerfile / scripts/provision-host.sh). Check on a ddev bump.
// Node needs no list: ddev installs any version via `n`.
export const DDEV_PHP_VERSIONS = ['5.6', '7.0', '7.1', '7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4'] as const
export const DDEV_DEFAULT_PHP = '8.4'
export const DDEV_DEFAULT_NODE = '22'
// The Node majors offered as overrides and resolved from open-ended
// constraints (`engines.node: >=20`): the LTS lines, newest first.
export const NODE_LTS_MAJORS = ['24', '22', '20', '18'] as const

// A Node override as ddev's `nodejs_version` takes it: major or major.minor.
export const NODE_VERSION_PATTERN = /^\d+(\.\d+)?$/

export const ENV_DEFAULTS: EnvSpec = {
  phpVersion: DDEV_DEFAULT_PHP,
  nodeVersion: DDEV_DEFAULT_NODE,
  hasDb: false,
  hosts: [],
  devServer: null,
  previewPort: null,
}

// The detection stored on a project at connect time (projects.ddevEnv),
// which is what the settings card and every "does this project have a
// database / a preview" question resolve against. Rows resolved before
// detection existed were all ddev projects with a database.
export function projectDetectedEnv(env: { detected?: DetectedEnv } | null | undefined): DetectedEnv {
  return env?.detected ?? {
    source: 'ddev',
    fields: { hasDb: { value: true, source: '.ddev/config.yaml' } },
    warnings: [],
  }
}

// Setting > detection > default. For a 'ddev' project the overrides are
// ignored: the committed config.yaml is the truth (and the settings page
// hides the inputs), so a stale override can never fight the repo.
export function resolveEnv(detected: DetectedEnv, overrides: EnvOverrides): ResolvedEnv {
  const detect = <K extends keyof EnvSpec>(key: K): ResolvedField<EnvSpec[K]> =>
    detected.fields[key] ?? { value: ENV_DEFAULTS[key], source: 'default' }
  const override = <K extends keyof EnvOverrides>(key: K): ResolvedField<EnvSpec[K]> => {
    const value = overrides[key] as EnvSpec[K] | null
    return detected.source === 'generated' && value != null ? { value, source: 'setting' } : detect(key)
  }
  return {
    source: detected.source,
    phpVersion: override('phpVersion'),
    nodeVersion: override('nodeVersion'),
    hasDb: detect('hasDb'),
    hosts: detect('hosts'),
    devServer: override('devServer'),
    previewPort: override('previewPort'),
  }
}

// "from composer.json" / "from setting" / "default": the provenance suffix
// the run log and the settings card append to a value.
export function sourceLabel(source: EnvSource): string {
  return source === 'default' ? 'default' : `from ${source}`
}

// One line describing the environment a session boots with, for the run log
// next to the environment name:
//   generated: PHP 8.2 from composer.json, Node 22 from .nvmrc, no database, no dev server
//   from .ddev/config.yaml: hosts demo.ddev.site, alpha.ddev.site
export function formatEnvSummary(env: ResolvedEnv): string {
  if (env.source === 'ddev') {
    const hosts = env.hosts.value.length ? `: hosts ${env.hosts.value.join(', ')}` : ''
    return `from .ddev/config.yaml${hosts}`
  }
  const devServer = env.devServer.value
    ? `dev server '${env.devServer.value}' on port ${env.previewPort.value ?? '?'}`
    : 'no dev server'
  return [
    `generated: PHP ${env.phpVersion.value} ${sourceLabel(env.phpVersion.source)}`,
    `Node ${env.nodeVersion.value} ${sourceLabel(env.nodeVersion.source)}`,
    env.hasDb.value ? 'database' : 'no database',
    devServer,
  ].join(', ')
}
