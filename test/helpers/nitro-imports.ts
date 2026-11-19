// Nitro provides these at runtime; a test that reaches one mocks #imports.
const unmocked = (name: string) => () => {
  throw new Error(`${name} comes from Nitro: vi.mock('#imports') in this test`)
}

export const getUserSession = unmocked('getUserSession')
export const requireUserSession = unmocked('requireUserSession')
export const replaceUserSession = unmocked('replaceUserSession')
export const clearUserSession = unmocked('clearUserSession')
export const hashPassword = unmocked('hashPassword')
export const verifyPassword = unmocked('verifyPassword')
export const useStorage = unmocked('useStorage')
export const defineNitroPlugin = <T>(plugin: T) => plugin
