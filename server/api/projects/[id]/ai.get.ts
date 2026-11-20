import { defineEventHandler } from 'h3'
import { requireProject } from '#server/stores/projects'
import { projectAiView } from '#server/utils/ai-connection'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(event => projectAiView(requireProject(requireIntParam(event)).id))
