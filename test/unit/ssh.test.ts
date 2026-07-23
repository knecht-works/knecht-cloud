import { describe, expect, it } from 'vitest'
import { sshTerminalCommand, vscodeRemoteUrl } from '../../server/utils/ssh'

describe('ssh command builder', () => {
  it('builds the web-container command with identity and workdir', () => {
    expect(sshTerminalCommand({
      sshTarget: 'knecht@my-server.com',
      containerName: 'ddev-knecht-run-7-web',
      workdir: '/var/www/html',
      user: { uid: 1000, gid: 1000, user: 'samuel', home: '/home/samuel' },
    })).toBe(
      'ssh -t knecht@my-server.com docker exec -it -u 1000:1000 -w /var/www/html'
      + ' -e HOME=/home/samuel -e USER=samuel ddev-knecht-run-7-web bash -l',
    )
  })

  it('builds a plain default-user command for other services', () => {
    expect(sshTerminalCommand({
      sshTarget: 'root@1.2.3.4',
      containerName: 'ddev-knecht-run-7-db',
    })).toBe('ssh -t root@1.2.3.4 docker exec -it ddev-knecht-run-7-db bash')
  })
})

describe('vscode remote url', () => {
  it('builds the Remote-SSH deep link', () => {
    expect(vscodeRemoteUrl('knecht@my-server.com', '/data/knecht/projects/run-7'))
      .toBe('vscode://vscode-remote/ssh-remote+knecht@my-server.com/data/knecht/projects/run-7')
  })

  it('percent-encodes path characters the URL cannot carry raw', () => {
    expect(vscodeRemoteUrl('knecht@host', '/data/projekte/mein projekt/run-7'))
      .toBe('vscode://vscode-remote/ssh-remote+knecht@host/data/projekte/mein%20projekt/run-7')
  })
})
