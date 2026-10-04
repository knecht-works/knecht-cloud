import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// The key derives from NUXT_SESSION_PASSWORD. Rotating that password makes
// stored secrets unreadable; the fix is to re-run the GitHub App setup.

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

export function deriveKey(salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', process.env.NUXT_SESSION_PASSWORD!, salt, info, 32))
}

function key(): Buffer {
  return deriveKey('knecht-secret-store', 'aes-256-gcm')
}

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
