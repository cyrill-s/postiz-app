import {
  parseFragment,
  Element as DefaultTreeElement,
  Node as DefaultTreeNode,
} from 'parse5';

export const FORMATTED_PLATFORMS = [
  'telegram',
  'max',
  'ok-community',
  'vk',
  'vk-community',
  'threads',
  'youtube',
] as const;
export const supportsSocialFormatting = (platform: string) =>
  (FORMATTED_PLATFORMS as readonly string[]).includes(platform);
export const escapeSocialHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
export type SpoilerEntity = {
  entity_type: 'SPOILER';
  offset: number;
  length: number;
};
export type CompiledSocialContent = {
  message: string;
  text: string;
  previewHtml: string;
  textEntities: SpoilerEntity[];
  length: number;
};
type Fragment = Omit<CompiledSocialContent, 'length'>;
const empty = (): Fragment => ({
  message: '',
  text: '',
  previewHtml: '',
  textEntities: [],
});
const literal = (text: string, rich: boolean): Fragment => ({
  text,
  message: rich ? escapeSocialHtml(text) : text,
  previewHtml: escapeSocialHtml(text),
  textEntities: [],
});
function join(parts: Fragment[]): Fragment {
  const result = empty();
  for (const part of parts) {
    result.textEntities.push(
      ...part.textEntities.map((entity) => ({
        ...entity,
        offset: entity.offset + Array.from(result.text).length,
      }))
    );
    result.text += part.text;
    result.message += part.message;
    result.previewHtml += part.previewHtml;
  }
  return result;
}
const blockTags = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
]);
const styleTags: Record<string, string> = {
  strong: 'b',
  b: 'b',
  em: 'i',
  i: 'i',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
};
const attribute = (node: DefaultTreeElement, name: string) =>
  node.attrs?.find((a) => a.name === name)?.value;
export const safeSocialLink = (href: string) =>
  /^(https?:\/\/|mailto:)/i.test(href) && !/[\u0000-\u0020]/.test(href);

/** Compile the saved editor HTML once, for the API payload, preview and validation. */
export function compileSocialContent(
  platform: string,
  source: string,
  mention?: (id: string, name: string) => string
): CompiledSocialContent {
  const rich = platform === 'telegram' || platform === 'max';
  function children(
    node: DefaultTreeElement,
    inCode = false,
    inQuote = false
  ): Fragment {
    const parts: Fragment[] = [];
    let previousBlock = false;
    for (const child of node.childNodes || []) {
      if (
        ['script', 'style', 'iframe', 'object'].includes(
          (child as DefaultTreeElement).tagName
        )
      )
        continue;
      const block = blockTags.has((child as DefaultTreeElement).tagName);
      // Ignore indentation between HTML block elements, not intentional text/code spaces.
      if (
        !inCode &&
        child.nodeName === '#text' &&
        /^\s*\n\s*$/.test((child as { value: string }).value)
      )
        continue;
      if (parts.length && (block || previousBlock))
        parts.push(literal('\n', rich));
      parts.push(render(child, inCode, inQuote));
      previousBlock = block;
    }
    return join(parts);
  }
  function render(
    node: DefaultTreeNode,
    inCode = false,
    inQuote = false
  ): Fragment {
    if (node.nodeName === '#text')
      return literal(
        (node as { value: string }).value.replace(/\u00a0/g, ' '),
        rich
      );
    const element = node as DefaultTreeElement;
    const tag = element.tagName;
    if (['script', 'style', 'iframe', 'object'].includes(tag)) return empty();
    if (tag === 'br') return literal('\n', rich);
    const mentionId = attribute(element, 'data-mention-id');
    if (mentionId && mention)
      return literal(mention(mentionId, children(element).text), rich);
    if (tag === 'ul' || tag === 'ol') {
      const start = Number(attribute(element, 'start')) || 1;
      return join(
        (element.childNodes || [])
          .filter((n) => (n as DefaultTreeElement).tagName === 'li')
          .map((n, index) =>
            join([
              literal(
                `${index ? '\n' : ''}${
                  tag === 'ul' ? '•' : `${start + index}.`
                } `,
                rich
              ),
              children(n as DefaultTreeElement, inCode, inQuote),
            ])
          )
      );
    }
    const code = inCode || tag === 'pre' || tag === 'code';
    const body = children(element, code, inQuote || tag === 'blockquote');
    if (tag === 'pre' || (tag === 'code' && !inCode)) {
      // Telegram forbids formatting entities inside code/pre.
      const result = literal(body.text, rich);
      if (rich) {
        result.message = `<${tag}>${escapeSocialHtml(body.text)}</${tag}>`;
        result.previewHtml = `<${tag}>${escapeSocialHtml(body.text)}</${tag}>`;
      }
      return result;
    }
    if (inCode) return literal(body.text, rich);
    if (tag === 'a') {
      const href = attribute(element, 'href') || '';
      if (!safeSocialLink(href)) return body;
      if (rich)
        return {
          ...body,
          message: `<a href="${escapeSocialHtml(href)}">${body.message}</a>`,
          previewHtml: `<a href="${escapeSocialHtml(
            href
          )}" target="_blank" rel="noopener noreferrer">${
            body.previewHtml
          }</a>`,
        };
      return body.text === href
        ? body
        : join([body, literal(` (${href})`, rich)]);
    }
    if (tag === 'blockquote') {
      if (rich) {
        // Telegram does not accept nested blockquotes.
        if (inQuote) return body;
        const expandable =
          platform === 'telegram' &&
          (attribute(element, 'data-expandable') === 'true' ||
            attribute(element, 'expandable') !== undefined);
        return {
          ...body,
          message: `<blockquote${expandable ? ' expandable' : ''}>${
            body.message
          }</blockquote>`,
          previewHtml: expandable
            ? `<details><summary>…</summary><blockquote>${body.previewHtml}</blockquote></details>`
            : `<blockquote>${body.previewHtml}</blockquote>`,
        };
      }
      // Prefix during traversal so spoiler offsets include the quote marker on every line.
      if (platform === 'youtube')
        return join([literal('«', rich), body, literal('»', rich)]);
      const lines = body.text.split('\n');
      const result = literal(lines.map((line) => `> ${line}`).join('\n'), rich);
      result.textEntities = body.textEntities.map((entity) => {
        const before = Array.from(body.text).slice(0, entity.offset).join('');
        const inside = Array.from(body.text)
          .slice(entity.offset, entity.offset + entity.length)
          .join('');
        return {
          ...entity,
          offset: entity.offset + 2 * before.split('\n').length,
          length: entity.length + 2 * (inside.split('\n').length - 1),
        };
      });
      return result;
    }
    const spoiler =
      tag === 'tg-spoiler' ||
      attribute(element, 'data-spoiler') === 'true' ||
      attribute(element, 'class')?.split(' ').includes('tg-spoiler');
    if (spoiler && body.text && !/<(?:code|pre)[ >]/.test(body.message)) {
      if (platform === 'telegram')
        return {
          ...body,
          message: `<tg-spoiler>${body.message}</tg-spoiler>`,
          previewHtml: `<span data-spoiler="true" role="button" tabindex="0" aria-expanded="false">${body.previewHtml}</span>`,
        };
      if (platform === 'threads')
        return {
          ...body,
          textEntities: [
            {
              entity_type: 'SPOILER',
              offset: 0,
              length: Array.from(body.text).length,
            },
          ],
        };
    }
    if (rich && styleTags[tag] && !/<(?:code|pre)[ >]/.test(body.message))
      return {
        ...body,
        message: `<${styleTags[tag]}>${body.message}</${styleTags[tag]}>`,
        previewHtml: `<${styleTags[tag]}>${body.previewHtml}</${styleTags[tag]}>`,
      };
    return body;
  }
  const result = render(parseFragment(source || ''));
  if (platform === 'threads' && result.textEntities.length) {
    const chars = Array.from(result.text);
    let offset = 0;
    result.previewHtml =
      result.textEntities
        .sort((a, b) => a.offset - b.offset)
        .map((entity) => {
          const before = escapeSocialHtml(
            chars.slice(offset, entity.offset).join('')
          );
          offset = entity.offset + entity.length;
          return (
            before +
            `<span data-spoiler="true" role="button" tabindex="0" aria-expanded="false">${escapeSocialHtml(
              chars.slice(entity.offset, offset).join('')
            )}</span>`
          );
        })
        .join('') + escapeSocialHtml(chars.slice(offset).join(''));
  }
  return {
    ...result,
    length:
      platform === 'youtube'
        ? new TextEncoder().encode(result.text).length
        : Array.from(result.text).length,
  };
}

export function socialContentLimit(
  platform: string,
  hasMedia: boolean,
  separateText = false,
  fallback = 1000000
) {
  if (platform === 'telegram') return hasMedia && !separateText ? 1024 : 4096;
  if (platform === 'max') return 4000;
  if (platform === 'threads') return 500;
  if (platform === 'youtube') return 5000;
  return fallback;
}
