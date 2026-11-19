export function runWorkspacePath(projectId: number, runId: number): string {
  return `/projects/${projectId}?run=${runId}`
}

export function sessionWorkspacePath(projectId: number, sessionId: number): string {
  return `/projects/${projectId}?session=${sessionId}`
}
