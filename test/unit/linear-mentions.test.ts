import { describe, expect, it } from 'vitest'
import { addressedTo, bodyDataMentionIds } from '../../server/integrations/linear/mentions'

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

describe('addressedTo', () => {
  it('opens the reply with the handle, on its own line before a block', () => {
    expect(addressedTo('Fixed it.', 'sam')).toBe('@sam Fixed it.')
    expect(addressedTo('## Plan\n\n- one', 'sam')).toBe('@sam\n\n## Plan\n\n- one')
  })

  it('leaves a reply that names the handle already, but not a longer one', () => {
    expect(addressedTo('Done, @sam.', 'sam')).toBe('Done, @sam.')
    expect(addressedTo('Ask @samuel.', 'sam')).toBe('@sam Ask @samuel.')
  })
})
