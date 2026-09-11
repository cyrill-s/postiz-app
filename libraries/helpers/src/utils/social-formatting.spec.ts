import { compileSocialContent } from './social-formatting';

describe('Social post formatting', () => {
  it('preserves Telegram formatting and safely escapes literal HTML characters', () => {
    const result = compileSocialContent(
      'telegram',
      '<p><strong><em>Привет &amp; мир</em></strong> &lt;3</p>'
    );
    expect(result.message).toBe('<b><i>Привет &amp; мир</i></b> &lt;3');
    expect(result.text).toBe('Привет & мир <3');
  });
  it('adapts lists, links, quotes, code and spoilers to each destination without losing text', () => {
    const source =
      '<p><u><s>Текст</s></u> <span data-spoiler="true">секрет</span></p><ol start="3"><li><p>первый</p></li><li><p>второй</p></li></ol><blockquote data-expandable="true"><p>цитата</p></blockquote><pre><code>  a &lt; b\n    c</code></pre><p><a href="https://example.org">Купить</a></p>';
    expect(compileSocialContent('telegram', source).message).toBe(
      '<u><s>Текст</s></u> <tg-spoiler>секрет</tg-spoiler>\n3. первый\n4. второй\n<blockquote expandable>цитата</blockquote>\n<pre>  a &lt; b\n    c</pre>\n<a href="https://example.org">Купить</a>'
    );
    expect(compileSocialContent('max', source).message).toContain(
      '<blockquote>цитата</blockquote>'
    );
    expect(compileSocialContent('max', source).message).not.toContain(
      'spoiler'
    );
    for (const platform of ['vk', 'vk-community', 'ok-community', 'threads']) {
      expect(compileSocialContent(platform, source).message).toBe(
        'Текст секрет\n3. первый\n4. второй\n> цитата\n  a < b\n    c\nКупить (https://example.org)'
      );
    }
    expect(
      compileSocialContent('youtube', '<blockquote><p>цитата</p></blockquote>')
        .message
    ).toBe('«цитата»');
  });
  it('normalizes pasted code inside styling and does not turn unsafe links into executable preview HTML', () => {
    const source =
      '<p><strong><code>a &lt; b</code></strong> <a href="javascript:alert(1)">ссылка</a></p><script>alert(1)</script><p>&lt;img src=x onerror=alert(1)&gt;</p>';
    const result = compileSocialContent('telegram', source);
    expect(result.message).toBe(
      '<code>a &lt; b</code> ссылка\n&lt;img src=x onerror=alert(1)&gt;'
    );
    expect(result.previewHtml).not.toMatch(/<script|<img|javascript:/);
  });
  it('locates Threads spoilers after emoji, list markers, quote prefixes and expanded links', () => {
    const result = compileSocialContent(
      'threads',
      '<p>😀 <a href="https://x.test">сайт</a></p><ul><li><p><span data-spoiler="true">тайна</span></p></li></ul><blockquote><p><span data-spoiler="true">да</span></p></blockquote>'
    );
    expect(result.message).toBe('😀 сайт (https://x.test)\n• тайна\n> да');
    expect(result.textEntities).toEqual([
      { entity_type: 'SPOILER', offset: 26, length: 5 },
      { entity_type: 'SPOILER', offset: 34, length: 2 },
    ]);
    expect(result.previewHtml).toContain('aria-expanded="false">тайна</span>');
    expect(compileSocialContent('youtube', '<p>Привет</p>').length).toBe(12);
  });
});
