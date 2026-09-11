export function runWorkspacePath(projectId: number, runId: number): string {
  return `/projects/${projectId}?run=${runId}`
}
