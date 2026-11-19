// Explicit imports take $fetch from here, a module Nuxt generates without types.
declare module '#build/fetch.mjs' {
  export const $fetch: typeof globalThis.$fetch
}
