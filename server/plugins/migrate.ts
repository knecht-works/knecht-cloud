import { migrateDatabase } from '#server/db/migrate'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  migrateDatabase()
})
