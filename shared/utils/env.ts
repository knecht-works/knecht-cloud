export interface EnvVar {
  key: string
  value: string
}

export function envVarsToText(vars: EnvVar[]): string {
  return vars.map(v => `${v.key}=${v.value}`).join('\n')
}

// One layer of quotes is stripped: they would break ddev's generated docker-compose YAML.
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

export function unquote(v: string): string {
  const q = v[0]
  if (v.length >= 2 && (q === '"' || q === '\'') && v[v.length - 1] === q) {
    return v.slice(1, -1)
  }
  return v
}
