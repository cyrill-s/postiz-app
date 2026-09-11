'use client';

import { useIntegration } from './helpers/use.integration';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  compileSocialContent,
  socialContentLimit,
  escapeSocialHtml,
} from '@gitroom/helpers/utils/social-formatting';
import { useFormContext } from 'react-hook-form';

export function FormattedPreview({
  platform,
  maximumCharacters = 1000000,
}: {
  platform: string;
  maximumCharacters?: number;
}) {
  const { value, integration } = useIntegration();
  const form = useFormContext();
  const t = useT();
  const mediaDir = useMediaDirectory();
  const separateText =
    platform === 'telegram' && form?.watch('separateText') === true;
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="font-semibold">
        {integration?.name || t('global_edit', 'Global edit')}
      </div>
      {value.map((post, index) => {
        const compiled = compileSocialContent(platform, post.content);
        const hasMedia = !!post.image?.length;
        const limit = socialContentLimit(
          platform,
          hasMedia,
          separateText && index === 0,
          maximumCharacters
        );
        const split =
          separateText && index === 0 && hasMedia && !!compiled.text;
        const media = hasMedia ? (
          <div className="grid grid-cols-2 gap-2">
            {post.image!.map((image) => (
              <VideoOrImage
                key={image.id || image.path}
                autoplay={false}
                src={mediaDir.set(image.path)}
              />
            ))}
          </div>
        ) : null;
        const text = (
          <div
            className="social-formatted-preview whitespace-pre-wrap break-words"
            onClick={(event) => {
              const spoiler = (
                event.target as HTMLElement
              ).closest<HTMLElement>('[data-spoiler]');
              if (spoiler) {
                event.preventDefault();
                spoiler.setAttribute(
                  'aria-expanded',
                  spoiler.getAttribute('aria-expanded') === 'true'
                    ? 'false'
                    : 'true'
                );
              }
            }}
            onKeyDown={(event) => {
              if (
                (event.key === 'Enter' || event.key === ' ') &&
                (event.target as HTMLElement).matches('[data-spoiler]')
              ) {
                event.preventDefault();
                (event.target as HTMLElement).click();
              }
            }}
            dangerouslySetInnerHTML={{
              __html: compiled.previewHtml
                .replace(
                  /<summary>…<\/summary>/g,
                  `<summary>${escapeSocialHtml(
                    t('expand_quote', 'Expand quote')
                  )}</summary>`
                )
                .replace(
                  /role="button"/g,
                  `role="button" aria-label="${escapeSocialHtml(
                    t('reveal_spoiler', 'Reveal spoiler')
                  )}"`
                ),
            }}
          />
        );
        return (
          <div key={post.id || index} className="flex flex-col gap-3">
            <div
              className={
                compiled.length > limit ? 'text-red-500' : 'text-sm opacity-70'
              }
              role="status"
            >
              {compiled.length} / {limit}
              {platform === 'youtube' ? ` ${t('bytes', 'bytes')}` : ''}
              {compiled.length > limit &&
                ` — ${t(
                  'shorten_post_text',
                  'Shorten the text before publishing.'
                )}`}
            </div>
            {platform === 'youtube' && /[<>]/.test(compiled.text) && (
              <p role="alert">
                {t(
                  'youtube_angle_brackets',
                  'Remove < and > from the video description.'
                )}
              </p>
            )}
            {platform === 'telegram' &&
              index === 0 &&
              hasMedia &&
              (compiled.length > 1024 || separateText) &&
              form && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" {...form.register('separateText')} />
                  {t(
                    'telegram_send_two_messages',
                    'Send as two messages: media first, then the full text'
                  )}
                </label>
              )}
            {split ? (
              <>
                <div className="border border-borderPreview rounded-lg p-3">
                  <p className="text-sm opacity-70 mb-2">
                    {t('message_one_media', 'Message 1 · Media')}
                  </p>
                  {media}
                </div>
                <div className="border border-borderPreview rounded-lg p-3">
                  <p className="text-sm opacity-70 mb-2">
                    {t('message_two_text', 'Message 2 · Text')}
                  </p>
                  {text}
                </div>
              </>
            ) : (
              <div className="border border-borderPreview rounded-lg p-3 flex flex-col gap-3">
                {media}
                {text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
