import { listProjectSessionCounts } from '#server/stores/sessions'
import { defineEventHandler } from 'h3'

export default defineEventHandler(() => listProjectSessionCounts())
