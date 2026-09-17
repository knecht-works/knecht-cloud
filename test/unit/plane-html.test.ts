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
      + '<pre><code class="language-php">echo 1 &lt; 2;</code></pre>'
      + '<hr>'
      + '<p><strong>Preview:</strong> <a href="https://x/preview">https://x/preview</a> · <strong>PR:</strong> <a href="https://x/pull/9">https://x/pull/9</a></p>',
    )
    expect(htmlToMarkdown(html)).toBe(markdown.replace('```php', '```'))
  })

  it('escapes html in text, keeps line breaks and never fails on odd input', () => {
    expect(markdownToHtml('a <b> & c\nline two\n\n*not closed **bold')).toBe('<p>a &lt;b&gt; &amp; c<br>line two</p><p>*not closed **bold</p>')
    expect(markdownToHtml('')).toBe('<p></p>')
  })
})

describe('htmlToMarkdown', () => {
  it('turns Plane mentions and entities into text', () => {
    const html = '<p><mention-component entity_identifier="u1" entity_name="user_mention" label="Knecht"></mention-component> fix &quot;login&quot; &amp; logout</p><p>see <a href="https://x">https://x</a></p>'
    expect(htmlToMarkdown(html)).toBe('@Knecht fix "login" & logout\n\nsee https://x')
    expect(htmlToMarkdown(null)).toBe('')
  })
})
