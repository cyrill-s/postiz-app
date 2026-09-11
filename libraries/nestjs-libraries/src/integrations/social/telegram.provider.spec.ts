import TelegramBot from 'node-telegram-bot-api';
import { TelegramProvider } from './telegram.provider';
import { TelegramDeliveryState } from './social.integrations.interface';

jest.mock('node-telegram-bot-api', () =>
  jest.fn().mockImplementation(() => ({
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    sendMediaGroup: jest.fn(),
  }))
);

const mockBot = (TelegramBot as unknown as jest.Mock).mock.results[0].value;
const bot = () => mockBot;
describe('Telegram publishing', () => {
  beforeEach(() => jest.clearAllMocks());
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
      response: { body: { ok: false, description: 'Rejected' } },
    });
    await expect(
      new TelegramProvider().post('channel', '-100123', [post])
    ).rejects.toThrow(/partially/i);
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
});
