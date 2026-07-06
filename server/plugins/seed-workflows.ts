import { seedWorkflows } from '../workflows'

// Seed the bundled starter workflows into the table on first boot. Runs after
// `migrate` (alphabetical order), and is a no-op once the settings flag is set,
// so a fresh instance ships with the starters while user deletions/renames stick.
export default defineNitroPlugin(() => {
  seedWorkflows()
})
