import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_IMAGE_DIR, AGENT_IMAGE_FILE } from '#shared/utils/agent-images'
import { sessionCheckoutDir } from '#server/utils/storage'

const MAX_BYTES = 10 * 1024 * 1024

// The checkout is sandbox-writable: a symlink anywhere on the path would hand out Knecht's own files.
export async function readAgentImage(sessionId: number, file: string): Promise<Buffer | null> {
  if (!AGENT_IMAGE_FILE.test(file)) return null
  const checkout = sessionCheckoutDir(sessionId)
  try {
    const path = await realpath(join(checkout, AGENT_IMAGE_DIR, file))
    if (path !== join(await realpath(checkout), AGENT_IMAGE_DIR, file)) return null
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_BYTES) return null
      return await handle.readFile()
    }
    finally {
      await handle.close()
    }
  }
  catch {
    return null
  }
}
