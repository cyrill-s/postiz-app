'use client';

import { useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCalendar } from './calendar.context';

export function TelegramDeliveryStatus({
  id,
  delivery,
  state,
}: {
  id: string;
  delivery?: string | null;
  state: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fetch = useFetch();
  const t = useT();
  const calendar = useCalendar();
  if (!delivery || state !== 'ERROR') return null;
  let progress: { phase?: string; mediaMessageId?: number };
  try {
    progress = JSON.parse(delivery);
  } catch {
    return null;
  }
  if (!progress.mediaMessageId || progress.phase === 'completed') return null;
  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/posts/${id}/retry-telegram-text`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error();
      calendar.reloadCalendarView();
    } catch {
      setError(
        t(
          'telegram_retry_failed',
          'Could not retry the text. Refresh and try again.'
        )
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="p-2 text-xs bg-amber-500/15 rounded-lg"
      onClick={(event) => event.stopPropagation()}
    >
      <p>{t('published_partially', 'Published partially')}</p>
      {progress.phase === 'media-sent' ? (
        <button
          type="button"
          disabled={busy}
          onClick={retry}
          className="underline disabled:opacity-50"
        >
          {t('retry_text_only', 'Retry text only')}
        </button>
      ) : (
        <p>
          {t(
            'telegram_check_text_delivery',
            'Media was sent. Check the channel: text delivery is unconfirmed.'
          )}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
