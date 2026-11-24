export function runWorkspacePath(projectId: number, runId: number): string {
  return `/projects/${projectId}/sessions?run=${runId}`
}

export function sessionWorkspacePath(projectId: number, sessionId: number): string {
  return `/projects/${projectId}/sessions?session=${sessionId}`
}
