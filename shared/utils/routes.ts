// Where a run opens in the dashboard: inside its project's workspace,
// selected via ?run. The ONE place that knows the scheme (app links and
// server-built URLs like {{ run.url }}); /runs/:id only redirects here for
// old links.
export function runWorkspacePath(projectId: number, runId: number): string {
  return `/projects/${projectId}?run=${runId}`
}
