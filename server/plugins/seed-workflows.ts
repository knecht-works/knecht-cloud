import { seedWorkflows } from '../workflows'
import { defineNitroPlugin } from 'nitropack/runtime'

// Runs after migrate.ts: Nitro loads plugins alphabetically.
export default defineNitroPlugin(() => {
  seedWorkflows()
})
