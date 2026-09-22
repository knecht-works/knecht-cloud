import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, markdownToHtml } from '../../server/integrations/plane/html'

describe('markdownToHtml', () => {
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
      'echo 1 < 2;',
      '```',
      '',
      '---',
      '',
      '**Preview:** https://x/preview · **PR:** https://x/pull/9',
    ].join('\n')

    const html = markdownToHtml(markdown)
    expect(html).toBe(
      '<h1>Result</h1>'
      + '<p>Fixed the <strong>login</strong> in <code>auth.php</code>, see <a href="https://x/pull/9">the PR</a> and <a href="https://x/preview">https://x/preview</a>.</p>'
      + '<ul><li>first</li><li>second</li></ul>'
      + '<ol><li>one</li><li>two</li></ol>'
      + '<pre><code class="language-php">echo 1 &lt; 2;\n</code></pre>'
      + '<hr>'
      + '<p><strong>Preview:</strong> <a href="https://x/preview">https://x/preview</a> · <strong>PR:</strong> <a href="https://x/pull/9">https://x/pull/9</a></p>',
    )
    // turndown pads list markers to a four-column indent.
    expect(htmlToMarkdown(html)).toBe(markdown.replace(/^- /gm, '-   ').replace(/^(\d+\.) /gm, '$1  '))
  })

  it('escapes html in text, keeps line breaks and never fails on odd input', () => {
    expect(markdownToHtml('a <b> & c\nline two\n\n*not closed **bold')).toBe('<p>a &lt;b&gt; &amp; c<br>line two</p><p>*not closed **bold</p>')
    expect(markdownToHtml('')).toBe('<p></p>')
  })
})

describe('htmlToMarkdown', () => {
  it('names Plane mentions after the project members and unescapes entities', () => {
    const html = '<p><mention-component id="m1" entity_identifier="u1" entity_name="user_mention"></mention-component> fix &quot;login&quot; &amp; logout</p><p>see <a href="https://x">https://x</a></p>'
    expect(htmlToMarkdown(html, [{ id: 'u1', displayName: 'Knecht' }])).toBe('@Knecht fix "login" & logout\n\nsee https://x')
    expect(htmlToMarkdown(html)).toBe('@user fix "login" & logout\n\nsee https://x')
    expect(htmlToMarkdown(null)).toBe('')
  })
})

describe('mentions in replies', () => {
  const members = [{ id: 'u-ann', displayName: 'Ann Example' }, { id: 'u-annex', displayName: 'Ann' }]

  it('turns @Name of a project member into a Plane mention, longest name first', () => {
    const html = markdownToHtml('Hi @Ann Example, @Ann and @Nobody!', members)
    expect(html).toMatch(/^<p>Hi <mention-component id="[0-9a-f-]{36}" entity_identifier="u-ann" entity_name="user_mention"><\/mention-component>, <mention-component id="[0-9a-f-]{36}" entity_identifier="u-annex" entity_name="user_mention"><\/mention-component> and @Nobody!<\/p>$/)
  })

  it('leaves a name that continues as text alone', () => {
    expect(markdownToHtml('@Annette', members)).toBe('<p>@Annette</p>')
  })
})
