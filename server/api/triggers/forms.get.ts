import { gitTriggerForm } from '../../integrations/git-trigger-form'

export default defineEventHandler(() => ({ git: gitTriggerForm }))
