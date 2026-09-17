import { describe, expect, it } from 'vitest'
import { stripAnsi } from '../../shared/utils/ansi'

describe('stripAnsi', () => {
  it('removes colour and cursor sequences and keeps the text', () => {
    expect(stripAnsi('\u001B[33mNot trying\u001B[0m to add\u001B[2K\u001B[1A hosts')).toBe('Not trying to add hosts')
    expect(stripAnsi('plain')).toBe('plain')
  })

  it('removes OSC sequences such as terminal hyperlinks', () => {
    expect(stripAnsi('\u001B]8;;https://x\u0007link\u001B]8;;\u0007 done')).toBe('link done')
  })
})
