// The password seals session cookies and derives the key for stored secrets: with the
// published placeholder, anyone could forge a login and decrypt the database.
const PLACEHOLDER = 'change-me-to-a-random-string-at-least-32-chars'

export default defineNitroPlugin(() => {
  if (process.env.NUXT_SESSION_PASSWORD === PLACEHOLDER) {
    throw new Error('NUXT_SESSION_PASSWORD is still the placeholder from .env.example. Set it to a random string of at least 32 characters, for example with: openssl rand -hex 32')
  }
})
