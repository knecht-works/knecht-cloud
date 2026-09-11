// Every interpolated value is charset-checked upstream (settings PATCH) or
// derived, so the command stays one quote-free line that survives bash/zsh/fish.

export function defaultSshTarget(): string | null {
  const domain = process.env.KNECHT_BASE_DOMAIN
  return domain ? `root@${domain}` : null
}

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
