import { describe, expect, it } from 'vitest'
import { addressedTo, adfMentionIds, adfToMarkdown, markdownToAdf } from '../../server/integrations/jira/adf'

describe('markdownToAdf', () => {
  it('round-trips the subset Knecht replies use', () => {
    const markdown = [
      '# Result',
      '',
      'Fixed the **login** in `auth.php`, see [the PR](https://x/pull/9) and https://x/preview.',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '```php',
      'echo 1;',
      '```',
      '',
      '---',
      '',
      '**Preview:** https://x/preview · **PR:** https://x/pull/9',
    ].join('\n')

    const doc = markdownToAdf(markdown)
    expect(doc).toMatchObject({ type: 'doc', version: 1 })
    expect(doc.content?.map(n => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'codeBlock', 'rule', 'paragraph'])
    expect(adfToMarkdown(doc)).toBe(markdown)
  })

  it('never fails on odd input and always yields at least one block', () => {
    const doc = markdownToAdf('line one\nline two\n\n*not closed **bold')
    expect(doc.content).toHaveLength(2)
    expect(adfToMarkdown(doc)).toBe('line one line two\n\n*not closed **bold')
    expect(markdownToAdf('').content).toEqual([{ type: 'paragraph', content: [] }])
  })

  it('turns @Name of a known person into a mention node, outside code', () => {
    const people = [{ id: 'a1', name: 'Ann Example' }, { id: 'a2', name: 'Ann' }]
    const doc = markdownToAdf('Hi **@Ann Example** and @Ann, not @Annette or `@Ann`', people)
    expect(doc.content![0]!.content).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'mention', attrs: { id: 'a1', text: '@Ann Example' } },
      { type: 'text', text: ' and ' },
      { type: 'mention', attrs: { id: 'a2', text: '@Ann' } },
      { type: 'text', text: ', not @Annette or ' },
      { type: 'text', text: '@Ann', marks: [{ type: 'code' }] },
    ])
  })
})

describe('adfMentionIds', () => {
  it('collects mention account ids anywhere in the document', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'a1', text: '@A' } }, { type: 'text', text: ' hi' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'b2' } }] }] }] },
      ],
    }
    expect(adfMentionIds(doc)).toEqual(['a1', 'b2'])
    expect(adfMentionIds(null)).toEqual([])
  })
})

describe('addressedTo', () => {
  const ann = { id: 'a1', name: 'Ann Example' }
  const mention = { type: 'mention', attrs: { id: 'a1', text: '@Ann Example' } }

  it('opens the first paragraph with a mention of the person', () => {
    expect(adfToMarkdown(addressedTo(markdownToAdf('Fixed it.\n\nSee the PR.'), ann))).toBe('@Ann Example Fixed it.\n\nSee the PR.')
  })

  it('puts the mention in its own paragraph before a heading or list', () => {
    const doc = addressedTo(markdownToAdf('# Result\n\nDone.'), ann)
    expect(doc.content?.map(n => n.type)).toEqual(['paragraph', 'heading', 'paragraph'])
    expect(doc.content?.[0]?.content?.[0]).toEqual(mention)
  })

  it('leaves a reply that already mentions the person alone', () => {
    const doc = markdownToAdf('Done, @Ann Example.', [ann])
    expect(addressedTo(doc, ann)).toBe(doc)
  })
})
