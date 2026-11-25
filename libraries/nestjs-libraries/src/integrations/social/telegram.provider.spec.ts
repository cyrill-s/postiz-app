import TelegramBot from 'node-telegram-bot-api';
import { TelegramProvider } from './telegram.provider';
import { TelegramDeliveryState } from './social.integrations.interface';
import { TelegramUpdates } from './telegram.updates';

jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('node-telegram-bot-api', () =>
  jest.fn().mockImplementation(() => ({
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    sendMediaGroup: jest.fn(),
    getChat: jest.fn(),
    getMe: jest.fn(),
    getChatMember: jest.fn(),
    getChatMemberCount: jest.fn(),
    getUpdates: jest.fn(),
    deleteMessage: jest.fn(),
  }))
);

const mockBot = (TelegramBot as unknown as jest.Mock).mock.results[0].value;
const bot = () => mockBot;
describe('Telegram publishing', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });
  it('sends media once and retries only the full formatted text after a rejected text message', async () => {
    let saved: TelegramDeliveryState | null = null;
    const post = {
      id: 'post-1',
      message: '<b>Текст</b>',
      sourceHtml: '<p><strong>Текст</strong></p>',
      settings: { separateText: true },
      media: [
        { type: 'image' as const, path: 'https://example.org/photo.jpg' },
      ],
      telegramDelivery: {
        load: async () => saved,
        save: async (state: TelegramDeliveryState) => {
          saved = state;
        },
      },
    };
    bot().sendPhoto.mockResolvedValue({ message_id: 10 });
    bot().sendMessage.mockRejectedValueOnce({
      code: 'ETELEGRAM',
      response: {
        body: {
          ok: false,
          error_code: 400,
          description: 'Bad Request: message is too long',
        },
      },
    });
    await expect(
      new TelegramProvider().post('channel', '-100123', [post])
    ).rejects.toThrow(/Retry only the text/);
    expect(saved).toMatchObject({ phase: 'media-sent', mediaMessageId: 10 });
    expect(bot().sendPhoto).toHaveBeenCalledWith(
      '-100123',
      'https://example.org/photo.jpg',
      expect.objectContaining({ caption: '' }),
      expect.anything()
    );
    bot().sendMessage.mockResolvedValue({ message_id: 11 });
    const result = await new TelegramProvider().post('channel', '-100123', [
      post,
    ]);
    expect(bot().sendPhoto).toHaveBeenCalledTimes(1);
    expect(bot().sendMessage).toHaveBeenLastCalledWith(
      '-100123',
      '<b>Текст</b>',
      { parse_mode: 'HTML' }
    );
    expect(result[0]).toMatchObject({
      id: 'post-1',
      postId: '11',
      status: 'completed',
    });
  });
  it('does not duplicate either message when a completed delivery is retried', async () => {
    const result = await new TelegramProvider().post('channel', '-100123', [
      {
        id: 'post-1',
        message: 'text',
        settings: { separateText: true },
        media: [{ type: 'image', path: 'https://example.org/photo.jpg' }],
        telegramDelivery: {
          load: async () => ({
            phase: 'completed',
            mediaMessageId: 10,
            textMessageId: 11,
          }),
          save: async () => {},
        },
      },
    ]);
    expect(result[0].postId).toBe('11');
    expect(bot().sendPhoto).not.toHaveBeenCalled();
    expect(bot().sendMessage).not.toHaveBeenCalled();
  });
  it('rejects an oversized media caption before sending anything', async () => {
    await expect(
      new TelegramProvider().post('channel', '-100123', [
        {
          id: 'post-1',
          message: '<b>' + 'я'.repeat(1025) + '</b>',
          settings: {},
          media: [{ type: 'image', path: 'https://example.org/photo.jpg' }],
        },
      ])
    ).rejects.toThrow(/1024/);
    expect(bot().sendPhoto).not.toHaveBeenCalled();
  });
  it('does not retry text whose delivery outcome is unknown', async () => {
    let saved: TelegramDeliveryState | null = {
      phase: 'media-sent',
      mediaMessageId: 10,
    };
    const post = {
      id: 'post-1',
      message: 'text',
      settings: { separateText: true },
      media: [
        { type: 'image' as const, path: 'https://example.org/photo.jpg' },
      ],
      telegramDelivery: {
        load: async () => saved,
        save: async (state: TelegramDeliveryState) => {
          saved = state;
        },
      },
    };
    bot().sendMessage.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(
      new TelegramProvider().post('channel', '-100123', [post])
    ).rejects.toThrow(/unconfirmed/);
    await expect(
      new TelegramProvider().post('channel', '-100123', [post])
    ).rejects.toThrow(/could not be confirmed/);
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(bot().sendPhoto).not.toHaveBeenCalled();
  });

  const post = { id: 'comment', message: '<b>Comment</b>', settings: {} };
  function discussion() {
    process.env.TELEGRAM_TOKEN = '123:synthetic';
    process.env.TELEGRAM_WEBHOOK_SECRET = 's'.repeat(32);
    bot().getChat.mockImplementation(async (id: number | string) =>
      String(id) === '-100123'
        ? {
            id: -100123,
            type: 'channel',
            username: 'channel',
            linked_chat_id: -100456,
          }
        : { id: -100456, type: 'supergroup', linked_chat_id: -100123 }
    );
    bot().getMe.mockResolvedValue({ id: 123 });
    bot().getChatMember.mockResolvedValue({ status: 'administrator' });
  }

  it('sends both channel comments to the linked discussion root, preserving formatting and links', async () => {
    discussion();
    jest
      .spyOn(TelegramUpdates.prototype, 'discussion')
      .mockResolvedValue({ chatId: -100456, messageId: 77 });
    bot()
      .sendMessage.mockResolvedValueOnce({ message_id: 81 })
      .mockResolvedValueOnce({ message_id: 82 });
    const provider = new TelegramProvider();
    const first = await provider.comment(
      'channel',
      '10',
      undefined,
      '-100123',
      [post],
      {} as any
    );
    await provider.comment('channel', '10', '81', '-100123', [post], {} as any);
    expect(bot().sendMessage.mock.calls).toEqual([
      [
        '-100456',
        '<b>Comment</b>',
        { parse_mode: 'HTML', reply_to_message_id: 77 },
      ],
      [
        '-100456',
        '<b>Comment</b>',
        { parse_mode: 'HTML', reply_to_message_id: 77 },
      ],
    ]);
    expect(first[0]).toMatchObject({
      postId: '81',
      releaseURL: 'https://t.me/channel/10?comment=81',
    });
  });

  it('waits for the automatic-forward webhook before sending a comment', async () => {
    discussion();
    const read = jest
      .spyOn(TelegramUpdates.prototype, 'discussion')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ chatId: -100456, messageId: 77 });
    bot().sendMessage.mockResolvedValue({ message_id: 81 });
    await new TelegramProvider().comment(
      'channel',
      '10',
      undefined,
      '-100123',
      [post],
      {} as any
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([null, { chatId: -100999, messageId: 77 }])(
    'never sends an orphan comment or crosses channels: %j',
    async (mapping) => {
      discussion();
      jest
        .spyOn(TelegramUpdates.prototype, 'discussion')
        .mockResolvedValue(mapping);
      await expect(
        new TelegramProvider().comment(
          'channel',
          '10',
          undefined,
          '-100123',
          [post],
          {} as any
        )
      ).rejects.toThrow('ветка обсуждения');
      expect(bot().sendMessage).not.toHaveBeenCalled();
    }
  );

  it('rejects comments before publishing when discussions are not configured', async () => {
    bot().getChat.mockResolvedValue({ id: -100123, type: 'channel' });
    expect(
      await new TelegramProvider().checkCommentSupport('channel', '-100123')
    ).toContain('Привяжите группу');
    expect(bot().sendMessage).not.toHaveBeenCalled();
  });

  it('requires the bot to administer the linked discussion group', async () => {
    discussion();
    bot().getChatMember.mockResolvedValue({ status: 'left' });
    expect(
      await new TelegramProvider().checkCommentSupport('channel', '-100123')
    ).toContain('администратором');
  });

  it('keeps native replies in groups under the original message', async () => {
    bot().getChat.mockResolvedValue({ id: -100123, type: 'supergroup' });
    bot().sendMessage.mockResolvedValue({ message_id: 81 });
    const result = await new TelegramProvider().comment(
      '-100123',
      '10',
      '80',
      '-100123',
      [post],
      {} as any
    );
    expect(bot().sendMessage).toHaveBeenCalledWith(
      '-100123',
      '<b>Comment</b>',
      { parse_mode: 'HTML', reply_to_message_id: 10 }
    );
    expect(result[0].releaseURL).toBe('https://t.me/c/123/81');
  });

  it('does not retry an ambiguous send and never exposes the bot token', async () => {
    discussion();
    jest
      .spyOn(TelegramUpdates.prototype, 'discussion')
      .mockResolvedValue({ chatId: -100456, messageId: 77 });
    bot().sendMessage.mockRejectedValue(
      new Error('https://api.telegram.org/bot123:synthetic/sendMessage')
    );
    await expect(
      new TelegramProvider().comment(
        'channel',
        '10',
        undefined,
        '-100123',
        [post],
        {} as any
      )
    ).rejects.toThrow('не подтвердил');
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns a real participant snapshot and omits unavailable view metrics', async () => {
    bot().getChatMemberCount.mockResolvedValue(123);
    const data = await new TelegramProvider().analytics(
      'channel',
      '-100123',
      7
    );
    expect(data).toEqual([
      expect.objectContaining({
        type: 'snapshot',
        label: 'Подписчики',
        data: [expect.objectContaining({ total: '123' })],
      }),
    ]);
    expect(bot().getChatMemberCount).toHaveBeenCalledWith('-100123');
    bot().getChatMemberCount.mockResolvedValue(undefined);
    expect(
      await new TelegramProvider().analytics('channel', '-100123', 7)
    ).toEqual([]);
  });

  it('reads onboarding receipts instead of calling getUpdates in webhook mode', async () => {
    discussion();
    jest.spyOn(TelegramUpdates.prototype, 'connection').mockResolvedValue(null);
    expect(
      await new TelegramProvider().getBotId({ word: 'abcd', id: 99 })
    ).toEqual({});
    expect(bot().getUpdates).not.toHaveBeenCalled();
  });

  it('completes the existing connect flow from a webhook receipt', async () => {
    jest.useFakeTimers();
    discussion();
    jest.spyOn(TelegramUpdates.prototype, 'connection').mockResolvedValue({
      chatId: -100123, messageId: 7, updateId: 99,
    });
    bot().getChatMember.mockResolvedValue({ status: 'administrator', can_delete_messages: true });
    bot().sendMessage.mockResolvedValue({ message_id: 8 });
    expect(await new TelegramProvider().getBotId({ word: 'abcd' })).toEqual({ chatId: -100123 });
    expect(bot().getUpdates).not.toHaveBeenCalled();
    expect(bot().deleteMessage).toHaveBeenCalledWith(-100123, 7);
    await jest.advanceTimersByTimeAsync(10000);
    expect(bot().deleteMessage).toHaveBeenCalledWith(-100123, 8);
  });

  it('keeps polling onboarding available when webhook mode is not configured', async () => {
    bot().getUpdates.mockResolvedValue([]);
    expect(
      await new TelegramProvider().getBotId({ word: 'abcd', id: 99 })
    ).toEqual({});
    expect(bot().getUpdates).toHaveBeenCalledWith({
      offset: 99,
      allowed_updates: ['message', 'channel_post'],
    });
  });
});
