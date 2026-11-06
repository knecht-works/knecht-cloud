import { describe, expect, it } from 'vitest'
import { addressedTo, htmlToMarkdown, markdownToHtml } from '../../server/integrations/plane/html'

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

describe('addressedTo', () => {
  const mention = (id: string) => new RegExp(`^<p><mention-component [^>]*entity_identifier="${id}"[^>]*></mention-component>`)

  it('opens the first paragraph with a mention, or puts one before a heading', () => {
    expect(addressedTo('<p>Fixed it.</p>', 'u1')).toMatch(new RegExp(`${mention('u1').source} Fixed it\\.</p>$`))
    expect(addressedTo('<h2>Plan</h2>', 'u1')).toMatch(new RegExp(`${mention('u1').source}</p><h2>Plan</h2>$`))
  })

  it('leaves a reply that mentions the person already', () => {
    const html = markdownToHtml('Done, @Ann.', [{ id: 'u1', displayName: 'Ann' }] as never)
    expect(addressedTo(html, 'u1')).toBe(html)
  })
})

describe('links in replies', () => {
  it.each([
    '[a](javascript:alert(1))',
    '[a](JaVaScRiPt:alert(1))',
    '[a](javascript&#58;alert(1))',
    '[a](java&#x73;cript:alert(1))',
    '<javascript:alert(1)>',
    '[a](data:text/html,x)',
  ])('keeps only the text of %s', (markdown) => {
    const html = markdownToHtml(markdown)
    expect(html).not.toContain('href=')
  })

  it('keeps only the alt text of an image with a script source', () => {
    expect(markdownToHtml('![shot](javascript:alert(1))')).toBe('<p>shot</p>')
  })

  it('keeps web, mail and relative links', () => {
    expect(markdownToHtml('[ok](https://x.dev/a?b=1&c=2)')).toContain('<a href="https://x.dev/a?b=1&c=2">ok</a>')
    expect(markdownToHtml('[m](mailto:a@b.c)')).toContain('<a href="mailto:a@b.c">m</a>')
    expect(markdownToHtml('[rel](/docs/a)')).toContain('<a href="/docs/a">rel</a>')
    expect(markdownToHtml('see https://x.dev')).toContain('<a href="https://x.dev">https://x.dev</a>')
  })
})
