import { Mark, mergeAttributes } from '@tiptap/react';
import Blockquote from '@tiptap/extension-blockquote';

export const Spoiler = Mark.create({
  name: 'spoiler',
  excludes: 'code',
  parseHTML: () => [
    { tag: 'span[data-spoiler="true"]' },
    { tag: 'tg-spoiler' },
  ],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-spoiler': 'true' }),
    0,
  ],
});

export const Quote = Blockquote.extend({
  addAttributes() {
    return {
      expandable: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-expandable') === 'true' ||
          element.hasAttribute('expandable'),
        renderHTML: (attributes) =>
          attributes.expandable ? { 'data-expandable': 'true' } : {},
      },
    };
  },
  content: 'paragraph+',
});
