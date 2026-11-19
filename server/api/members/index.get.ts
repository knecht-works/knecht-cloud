import { listMembers } from '#server/stores/members'
import { defineEventHandler } from 'h3'

export default defineEventHandler(() => listMembers())
