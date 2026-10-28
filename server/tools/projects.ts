import { z } from 'zod'
import { listProjects, requireProject } from '../stores/projects'
import { defineTool } from './registry'

export const listProjectsTool = defineTool({
  name: 'list_projects',
  description: 'Lists the projects: the GitHub repositories connected to Knecht.',
  scope: 'projects:read',
  input: z.object({}),
  run: () => listProjects().map(p => ({
    id: p.id,
    fullName: p.fullName,
    defaultBranch: p.defaultBranch,
    framework: p.framework,
    frameworkVersion: p.frameworkVersion,
  })),
})

export const getProjectTool = defineTool({
  name: 'get_project',
  description: 'Returns one project\'s configuration: environment, boot commands, agent instructions. Env var values are left out.',
  scope: 'projects:read',
  input: z.object({ projectId: z.number().int() }),
  run: ({ projectId }) => {
    const p = requireProject(projectId)
    return {
      id: p.id,
      fullName: p.fullName,
      defaultBranch: p.defaultBranch,
      private: p.private,
      framework: p.framework,
      frameworkVersion: p.frameworkVersion,
      ddevEnv: p.ddevEnv,
      phpVersion: p.phpVersion,
      nodeVersion: p.nodeVersion,
      packageManager: p.packageManager,
      database: p.database,
      devServer: p.devServer,
      previewPort: p.previewPort,
      envVarKeys: p.envVars.map(v => v.key),
      sharedFolders: p.sharedFolders,
      bootCommands: p.bootCommands,
      agentInstructions: p.agentInstructions,
      mentionsEnabled: p.mentionsEnabled,
    }
  },
})
