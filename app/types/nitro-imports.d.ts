import type * as nitro from '#build/types/nitro-imports'

// Typed API routes pull server files into the app typecheck, whose #imports has no server utils.
declare module '#imports' {
  export const getUserSession: typeof nitro.getUserSession
  export const requireUserSession: typeof nitro.requireUserSession
  export const replaceUserSession: typeof nitro.replaceUserSession
  export const clearUserSession: typeof nitro.clearUserSession
  export const hashPassword: typeof nitro.hashPassword
  export const verifyPassword: typeof nitro.verifyPassword
}
