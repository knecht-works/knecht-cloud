export interface EnvVar {
  key: string
  value: string
}

// Serialize env vars to editable `KEY=value` lines.
export function envVarsToText(vars: EnvVar[]): string {
  return vars.map(v => `${v.key}=${v.value}`).join('\n')
}

// Parse raw `.env` text into env vars. Blank lines, comments (`#…`) and lines
// without `=` are ignored; the value keeps everything after the first `=`, minus
// one layer of surrounding quotes (`KEY="v"` → `v`) — otherwise the quotes end
// up in the value and break ddev's generated docker-compose YAML.
export function parseEnvText(text: string): EnvVar[] {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const eq = line.indexOf('=')
      return { key: line.slice(0, eq).trim(), value: unquote(line.slice(eq + 1).trim()) }
    })
    .filter(v => v.key)
}

// Strip one layer of matching surrounding quotes (standard .env semantics).
export function unquote(v: string): string {
  const q = v[0]
  if (v.length >= 2 && (q === '"' || q === '\'') && v[v.length - 1] === q) {
    return v.slice(1, -1)
  }
  return v
}
