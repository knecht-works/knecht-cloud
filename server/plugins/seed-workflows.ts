import { seedWorkflows } from '../workflows'

// Runs after migrate.ts: Nitro loads plugins alphabetically.
export default defineNitroPlugin(() => {
  seedWorkflows()
})
