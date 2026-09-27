import { createHash, timingSafeEqual } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

export type TelegramDiscussion = { chatId: number; messageId: number };
type ConnectMessage = { chatId: number; messageId: number; updateId: number };

const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;

/** Stores only routing IDs; no message bodies or bot tokens are retained. */
export class TelegramUpdates {
  private key(suffix: string) {
    const bot = createHash('sha256')
      .update(process.env.TELEGRAM_TOKEN || '')
      .digest('hex')
      .slice(0, 24);
    return `telegram:${bot}:${suffix}`;
  }

  enabled() {
    return (
      !!process.env.TELEGRAM_TOKEN &&
      (process.env.TELEGRAM_WEBHOOK_SECRET?.length || 0) >= 32
    );
  }

  async webhook(secret: string | undefined, update: unknown) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      !this.enabled() ||
      !secret ||
      Buffer.byteLength(secret) !== Buffer.byteLength(expected!) ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(expected!))
    ) {
      throw new UnauthorizedException();
    }
    await this.receive(update);
    return { ok: true };
  }

  async receive(update: any) {
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0)
      return;
    const message = update.message || update.channel_post;
    if (!integer(message?.chat?.id) || !integer(message?.message_id)) return;
    const origin = message.forward_origin;
    // A manual forward must never establish a channel's discussion thread.
    if (
      message.is_automatic_forward === true &&
      message.chat.type === 'supergroup' &&
      origin?.type === 'channel' &&
      origin.chat?.type === 'channel' &&
      integer(origin.chat.id) &&
      integer(origin.message_id) &&
      origin.message_id > 0
    ) {
      await ioRedis.set(
        this.key(`discussion:${origin.chat.id}:${origin.message_id}`),
        JSON.stringify({
          chatId: message.chat.id,
          messageId: message.message_id,
        })
      );
    }
    const command = /^\/connect(?:@[a-zA-Z0-9_]+)? ([a-zA-Z0-9]{4,64})$/.exec(
      message.text || ''
    );
    if (
      command &&
      ['channel', 'supergroup', 'group'].includes(message.chat.type)
    ) {
      await ioRedis.set(
        this.key(`connect:${command[1]}`),
        JSON.stringify({
          chatId: message.chat.id,
          messageId: message.message_id,
          updateId: update.update_id,
        }),
        'EX',
        600,
        'NX'
      );
    }
  }

  async discussion(
    channelId: string,
    postId: string
  ): Promise<TelegramDiscussion | null> {
    const raw = await ioRedis.get(
      this.key(`discussion:${channelId}:${postId}`)
    );
    if (!raw) return null;
    const value = JSON.parse(raw);
    return integer(value?.chatId) &&
      integer(value?.messageId) &&
      value.messageId > 0
      ? value
      : null;
  }

  async connection(word: string): Promise<ConnectMessage | null> {
    if (!/^[a-zA-Z0-9]{4,64}$/.test(word || '')) return null;
    const raw = await ioRedis.getdel(this.key(`connect:${word}`));
    return raw ? JSON.parse(raw) : null;
  }
}
