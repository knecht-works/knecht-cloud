import { describe, expect, it } from 'vitest'
import { bodyDataMentionIds } from '../../server/integrations/linear/mentions'

describe('bodyDataMentionIds', () => {
  it('collects the user ids of mentions at any depth', () => {
    const bodyData = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'suggestion_userMentions', attrs: { id: 'u1', label: 'knecht' } }, { type: 'text', text: ' fix it' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'suggestion_userMentions', attrs: { id: 'u2' } }] }] }] },
      ],
    })
    expect(bodyDataMentionIds(bodyData)).toEqual(['u1', 'u2'])
  })

  it('finds nothing in a body without mentions, an empty or a broken one', () => {
    expect(bodyDataMentionIds(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' } }] }))).toEqual([])
    expect(bodyDataMentionIds(null)).toEqual([])
    expect(bodyDataMentionIds('{not json')).toEqual([])
  })
})
