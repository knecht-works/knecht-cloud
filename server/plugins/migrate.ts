import { migrateDatabase } from '../db/migrate'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  migrateDatabase()
})
