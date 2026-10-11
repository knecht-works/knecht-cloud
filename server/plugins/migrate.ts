import { migrateDatabase } from '../db/migrate'

export default defineNitroPlugin(() => {
  migrateDatabase()
})
