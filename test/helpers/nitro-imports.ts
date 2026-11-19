// Nitro provides these at runtime; the tests stub the ones a module needs as globals.
const stub = (name: string) => (...args: unknown[]) => (globalThis as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args)

export const getUserSession = stub('getUserSession')
export const requireUserSession = stub('requireUserSession')
export const replaceUserSession = stub('replaceUserSession')
export const clearUserSession = stub('clearUserSession')
export const hashPassword = stub('hashPassword')
export const verifyPassword = stub('verifyPassword')
export const useStorage = stub('useStorage')
export const defineNitroPlugin = <T>(plugin: T) => plugin
