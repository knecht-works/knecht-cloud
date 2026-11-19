import { gitTriggerForm } from '#server/integrations/git-trigger-form'
import { defineEventHandler } from 'h3'

export default defineEventHandler(() => ({ git: gitTriggerForm }))
