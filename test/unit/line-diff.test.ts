import { describe, expect, it } from 'vitest'
import { lineDiff } from '../../shared/utils/line-diff'

describe('lineDiff', () => {
  it('marks changed lines and keeps the unchanged ones in place', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nx\nc\nd\n')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'x' },
      { type: 'same', text: 'c' },
      { type: 'added', text: 'd' },
    ])
  })

  it('treats a missing old text as all added', () => {
    expect(lineDiff('', 'one\ntwo')).toEqual([
      { type: 'added', text: 'one' },
      { type: 'added', text: 'two' },
    ])
  })
})
