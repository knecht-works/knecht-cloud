import { listProjectSessionCounts } from '../../stores/sessions'
import { defineEventHandler } from 'h3'

export default defineEventHandler(() => listProjectSessionCounts())
