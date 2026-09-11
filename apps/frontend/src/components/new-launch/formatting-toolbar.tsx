'use client';

import { Editor } from '@tiptap/react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export function FormattingToolbar({ editor }: { editor: Editor | null }) {
  const t = useT();
  const buttons = [
    {
      label: t('format_italic', 'Italic'),
      icon: 'I',
      active: 'italic',
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: t('format_strike', 'Strikethrough'),
      icon: 'S̶',
      active: 'strike',
      run: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      label: t('format_spoiler', 'Spoiler'),
      icon: '◧',
      active: 'spoiler',
      run: () => editor?.chain().focus().toggleMark('spoiler').run(),
    },
    {
      label: t('format_bullet_list', 'Bullet list'),
      icon: '• ≡',
      active: 'bulletList',
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: t('format_ordered_list', 'Numbered list'),
      icon: '1.',
      active: 'orderedList',
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: t('format_inline_code', 'Inline code'),
      icon: '<>',
      active: 'code',
      run: () => editor?.chain().focus().toggleCode().run(),
    },
    {
      label: t('format_code_block', 'Code block'),
      icon: '{ }',
      active: 'codeBlock',
      run: () => editor?.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: t('format_quote', 'Quote'),
      icon: '❞',
      active: 'blockquote',
      run: () =>
        editor
          ?.chain()
          .focus()
          .toggleBlockquote()
          .updateAttributes('blockquote', { expandable: false })
          .run(),
    },
    {
      label: t('format_expandable_quote', 'Expandable quote'),
      icon: '❞⌄',
      active: '',
      run: () => {
        if (editor?.isActive('blockquote')) {
          editor
            .chain()
            .focus()
            .updateAttributes('blockquote', {
              expandable: !editor.getAttributes('blockquote').expandable,
            })
            .run();
        } else {
          editor
            ?.chain()
            .focus()
            .toggleBlockquote()
            .updateAttributes('blockquote', { expandable: true })
            .run();
        }
      },
    },
  ];
  return (
    <>
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          title={button.label}
          aria-label={button.label}
          aria-pressed={
            button.active
              ? !!editor?.isActive(button.active)
              : !!editor?.getAttributes('blockquote').expandable
          }
          className="select-none rounded-[6px] min-w-[30px] h-[30px] px-1 bg-newColColor flex justify-center items-center aria-pressed:ring-1 aria-pressed:ring-current"
          onMouseDown={(event) => event.preventDefault()}
          onClick={button.run}
        >
          {button.icon}
        </button>
      ))}
    </>
  );
}
