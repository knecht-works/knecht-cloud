import { COMPOSITE_CHILD_KEYS, isComposite, type Step } from '../../shared/utils/workflow'

// http steps carry credentials literally, in workflows as well as in a run's rendered params.
// Templated values only reference a secret, so they stay readable.
export function maskSecrets(params: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...params }
  if (typeof params.headers === 'string') {
    masked.headers = params.headers.split('\n').map((line) => {
      const colon = line.indexOf(':')
      return colon < 0 ? line : `${line.slice(0, colon)}: ${mask(line.slice(colon + 1).trim())}`
    }).join('\n')
  }
  if (typeof params.url === 'string') {
    masked.url = params.url
      .replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#@]+)@/i, (_, scheme: string, userinfo: string) => `${scheme}${mask(userinfo)}@`)
      .replace(/([?&][^=&#]+=)([^&#]*)/g, (_, key: string, value: string) => key + mask(value))
  }
  return masked
}

function mask(value: string): string {
  return value.includes('{{') ? value : '***'
}

export function maskStepSecrets(steps: Step[]): Step[] {
  return steps.map((step) => {
    const masked = maskSecrets(step as unknown as Record<string, unknown>)
    if (isComposite(step)) {
      for (const key of COMPOSITE_CHILD_KEYS[step.type]) masked[key] = maskStepSecrets(masked[key] as Step[])
    }
    return masked as unknown as Step
  })
}
