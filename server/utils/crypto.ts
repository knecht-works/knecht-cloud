import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// Symmetric encryption for secrets stored at rest (the GitHub App's client
// secret and private key live in the DB, not in env). The key is derived from
// NUXT_SESSION_PASSWORD (already mandatory to seal the session cookie), so
// enabling encryption adds no new env var. Rotating that password makes stored
// secrets unreadable; the fix is to re-run the GitHub App setup, not decrypt.

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // GCM standard nonce length
const TAG_LEN = 16

function key(): Buffer {
  const password = process.env.NUXT_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error(
      'NUXT_SESSION_PASSWORD must be set (≥ 32 chars): it seals the session cookie '
      + 'and derives the key that encrypts stored secrets. Generate: openssl rand -base64 32.',
    )
  }
  // Fixed salt/info: the password is the only secret input and it is per-instance
  // already. HKDF just stretches it to a proper 32-byte AES key.
  return Buffer.from(hkdfSync('sha256', password, 'knecht-secret-store', 'aes-256-gcm', 32))
}

// Returns `iv:tag:ciphertext`, all base64: one self-describing string per secret.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted payload: expected iv:tag:ciphertext.')
  }
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Malformed encrypted payload: bad iv/tag length.')
  }
  const decipher = createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}
