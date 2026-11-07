import { createHash, randomBytes } from 'node:crypto'

// Only the hash is stored: a link is shown once, when it is created.
export const newLinkToken = () => randomBytes(32).toString('base64url')
export const hashLinkToken = (token: string) => createHash('sha256').update(token).digest('hex')
