import { describe, expect, it } from 'vitest'
import { ddevErrorLine } from '../../server/utils/ddev-error'

describe('ddevErrorLine', () => {
  it('takes the error ddev printed before its usage text', () => {
    expect(ddevErrorLine('Error: boom\nUsage:\n  ddev start [flags]\n\nFlags:\n  -y, --yes   skip prompts')).toBe('boom')
  })

  it('names the statement the database rejected in a failed import', () => {
    const stderr = [
      '--------------',
      'INSERT INTO t VALUES (1',
      '--------------',
      '',
      'ERROR 1064 (42000) at line 2: You have an error in your SQL syntax',
      `Error: failed to import database 'db' for knecht-base-2-x: failed to import database: exit status 1`,
      'Usage:',
      '  ddev import-db [project] [flags]',
    ].join('\n')
    expect(ddevErrorLine(stderr)).toBe('ERROR 1064 (42000) at line 2: You have an error in your SQL syntax')
  })
})
