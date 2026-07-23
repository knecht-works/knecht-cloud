// Pure builders for the run page's remote-access strings. Knecht runs no sshd
// and manages no keys: both reuse the operator's EXISTING host access via the
// `sshTarget` setting (user@host). Every interpolated value is charset-checked
// upstream (settings PATCH) or derived (container names, passwd fields), so
// the command stays one quote-free line that survives bash/zsh/fish verbatim.

// The derived default when the setting is empty: a standard install is
// reached as root on the dashboard's base domain (install.sh runs as root
// there, and the domain's A record points at this server). Operators who
// reach the server differently override it in Settings. Dev (KNECHT_BASE_URL,
// no base domain) has no sensible default.
export function defaultSshTarget(): string | null {
  const domain = process.env.KNECHT_BASE_DOMAIN
  return domain ? `root@${domain}` : null
}

// The command that lands in an interactive shell inside a run's container from
// the operator's own terminal. `user` carries the identity for the web
// container (uid/gid + HOME/USER, mirroring how Knecht itself execs there);
// other services get the container's default user, like `ddev ssh -s db`.
export function sshTerminalCommand(opts: {
  sshTarget: string
  containerName: string
  workdir?: string
  user?: { uid: number, gid: number, user: string, home: string }
}): string {
  const exec = opts.user
    ? `docker exec -it -u ${opts.user.uid}:${opts.user.gid}`
    + (opts.workdir ? ` -w ${opts.workdir}` : '')
    + ` -e HOME=${opts.user.home} -e USER=${opts.user.user} ${opts.containerName} bash -l`
    : `docker exec -it${opts.workdir ? ` -w ${opts.workdir}` : ''} ${opts.containerName} bash`
  return `ssh -t ${opts.sshTarget} ${exec}`
}

// A VS Code Remote-SSH deep link opening `path` on the host behind sshTarget.
export function vscodeRemoteUrl(sshTarget: string, path: string): string {
  return `vscode://vscode-remote/ssh-remote+${sshTarget}${encodeURI(path)}`
}
