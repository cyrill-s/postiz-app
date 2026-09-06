import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '../social.abstract';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';
import FormDataUpload from 'form-data';
import { PassThrough } from 'stream';

const API = 'https://platform-api2.max.ru';
const MEDIA_NOTICE =
  'MAX: до 10 изображений или видео. Изображение — до 50 МБ, видео — до 250 МБ.';
type Credentials = { chatId: string; token: string };
type Attachment = { type: 'image' | 'video'; payload: Record<string, unknown> };

export class MaxProvider extends SocialAbstract implements SocialProvider {
  identifier = 'max';
  name = 'MAX';
  isBetweenSteps = false;
  scopes: string[] = [];
  editor = 'normal' as const;
  override maxConcurrentJob = 1;
  toolTip =
    'Публикация в канал MAX через собственного бота с правом публикации.';

  maxLength() {
    return 4000;
  }

  async customFields() {
    return [
      {
        key: 'token',
        label: 'Токен бота MAX',
        type: 'password' as const,
        validation: '/^[^\\s]{1,4096}$/',
        hint: 'MAX для бизнеса → Чат-боты → ваш бот → Расширенные настройки → Настроить.',
      },
      {
        key: 'chatId',
        label: 'ID канала (chat_id)',
        type: 'text' as const,
        validation: '/^-?[1-9][0-9]{0,15}$/',
        hint: 'Добавьте бота администратором с правом публикации. Укажите chat_id из события bot_added вашего бота. Инструкция: dev.max.ru/docs-api, раздел «Получение chat_id».',
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeId(32);
    return { state, url: state, codeVerifier: makeId(32) };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      id: '',
      name: '',
      accessToken: '',
      refreshToken: '',
      expiresIn: 0,
      username: '',
    };
  }

  private validCredentials(data: Credentials) {
    return (
      data &&
      typeof data.chatId === 'string' &&
      /^-?[1-9][0-9]{0,15}$/.test(data.chatId) &&
      Number.isSafeInteger(Number(data.chatId)) &&
      typeof data.token === 'string' &&
      /^\S{1,4096}$/.test(data.token)
    );
  }

  private fail(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
  }): Promise<AuthTokenDetails | string> {
    let credentials: Credentials;
    try {
      const data = JSON.parse(
        Buffer.from(params.code, 'base64').toString('utf8')
      );
      credentials = { chatId: data.chatId?.trim(), token: data.token?.trim() };
      if (!this.validCredentials(credentials))
        return 'Проверьте токен бота и числовой ID канала MAX.';
    } catch {
      return 'Укажите токен бота и ID канала MAX.';
    }
    try {
      const chat = await this.api<{
        chat_id: number;
        type: string;
        status: string;
        title: string;
        icon?: { url?: string };
      }>(`/chats/${credentials.chatId}`, credentials.token);
      if (
        String(chat.chat_id) !== credentials.chatId ||
        chat.type !== 'channel' ||
        chat.status !== 'active'
      ) {
        return 'Укажите ID активного канала MAX, в который добавлен бот.';
      }
      const member = await this.api<{
        is_admin: boolean;
        is_owner: boolean;
        permissions?: string[];
      }>(`/chats/${credentials.chatId}/members/me`, credentials.token);
      if (
        !member.is_owner &&
        !(
          member.is_admin &&
          member.permissions?.some((p) =>
            ['write', 'post_edit_delete_message'].includes(p)
          )
        )
      ) {
        return 'Назначьте бота администратором канала с правом публикации и повторите подключение.';
      }
      return {
        id: `max:${credentials.chatId}`,
        name: chat.title || 'MAX',
        accessToken: AuthService.fixedEncryption(JSON.stringify(credentials)),
        refreshToken: '',
        expiresIn: 0,
        picture: chat.icon?.url || '',
        username: '',
      };
    } catch (error) {
      if (error instanceof BadBody || error instanceof RefreshToken)
        return error.message;
      return 'Не удалось проверить доступ к MAX. Повторите подключение позже.';
    }
  }

  // Never include raw upstream errors: they may echo the bot token or upload URL.
  private async api<T>(
    path: string,
    token: string,
    body?: unknown
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${API}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
        dispatcher: getSsrfSafeDispatcher(),
      } as RequestInit).catch(() => {
        this.fail(
          'Нет подтверждения от MAX. Проверьте канал перед повторной публикацией.'
        );
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data as T;
      if (response.status === 401)
        throw new RefreshToken(
          this.identifier,
          '{}',
          '{}',
          'Токен бота MAX недействителен. Подключите канал заново.'
        );
      if (response.status === 403)
        this.fail('Боту MAX не хватает прав. Разрешите публикацию в канале.');
      if (
        attempt < 5 &&
        (response.status === 429 || data.code === 'attachment.not.ready')
      ) {
        await timer(Math.min(1000 * 2 ** attempt, 16000));
        continue;
      }
      // Do not retry ambiguous send failures: MAX has no idempotency key.
      this.fail(
        data.code === 'attachment.not.ready'
          ? 'MAX ещё обрабатывает медиафайл. Повторите публикацию позже.'
          : 'MAX не подтвердил запрос. Проверьте канал и содержимое публикации.'
      );
    }
  }

  override async checkValidity(
    posts: ValidityMedia[][]
  ): Promise<string | true> {
    if (posts.length !== 1)
      return 'MAX: одна публикация без цепочки комментариев.';
    if (posts.some((post) => post.length > 10)) return MEDIA_NOTICE;
    return true;
  }

  private async upload(
    media: NonNullable<PostDetails['media']>[number],
    token: string
  ): Promise<Attachment> {
    if (!['image', 'video'].includes(media.type)) this.fail(MEDIA_NOTICE);
    const size = await this.mediaSize(media.path, this.identifier);
    if (
      !Number.isFinite(size) ||
      size <= 0 ||
      size > (media.type === 'image' ? 50 : 250) * 1024 * 1024
    )
      this.fail(MEDIA_NOTICE);
    const upload = await this.api<{ url: string; token?: string }>(
      `/uploads?type=${media.type}`,
      token,
      {}
    );
    let target: URL;
    try {
      target = new URL(upload.url);
    } catch {
      this.fail('MAX не вернул адрес загрузки медиафайла.');
    }
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      !['iu.oneme.ru', 'omub.okcdn.ru', 'vu.okcdn.ru'].includes(target.hostname)
    ) {
      this.fail('MAX вернул неподдерживаемый адрес загрузки медиафайла.');
    }
    const source = await this.mediaStream(media.path, this.identifier);
    const form = new FormDataUpload();
    const body = new PassThrough();
    source.on('error', (error) => body.destroy(error));
    form.on('error', (error) => body.destroy(error));
    form.append('data', source, {
      filename:
        media.path.split('/').pop()?.split('?')[0] ||
        (media.type === 'image' ? 'image.jpg' : 'video.mp4'),
      knownLength: size,
    });
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          ...form.getHeaders(),
          'Content-Length': String(form.getLengthSync()),
        },
        body: form.pipe(body),
        duplex: 'half',
        signal: AbortSignal.timeout(300000),
        redirect: 'error',
        dispatcher: getSsrfSafeDispatcher(),
      } as any);
      if (!response.ok)
        this.fail('MAX отклонил загрузку медиафайла. Повторите публикацию.');
      // Video upload hosts may return XML; the attachment token came from /uploads.
      const data =
        media.type === 'video'
          ? (await response.text(), {})
          : await response.json();
      const payload = media.type === 'video' ? { token: upload.token } : data;
      // Images can return either a token or the photos map accepted by MAX.
      if (
        !(typeof payload?.token === 'string' && payload.token) &&
        !(
          media.type === 'image' &&
          data.photos &&
          Object.values(data.photos).some(
            (photo: any) => typeof photo?.token === 'string' && photo.token
          )
        )
      ) {
        this.fail('MAX не подтвердил загрузку медиафайла.');
      }
      return { type: media.type, payload };
    } catch (error) {
      if (error instanceof BadBody) throw error;
      this.fail('Не удалось загрузить медиафайл в MAX. Повторите публикацию.');
    } finally {
      source.destroy();
      form.destroy();
      body.destroy();
    }
  }

  async post(
    id: string,
    accessToken: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    let credentials: Credentials;
    try {
      credentials = JSON.parse(AuthService.fixedDecryption(accessToken));
    } catch {
      this.fail('Подключите канал MAX заново.');
    }
    if (
      !this.validCredentials(credentials) ||
      id !== `max:${credentials.chatId}`
    )
      this.fail('Данные подключения MAX не соответствуют каналу.');
    const validity = await this.checkValidity(
      posts.map((post) => post.media || [])
    );
    if (validity !== true) this.fail(validity);
    const post = posts[0];
    if (post.message.length > this.maxLength())
      this.fail('MAX: не более 4000 символов в публикации.');
    if (!post.message.trim() && !post.media?.length)
      this.fail('Добавьте текст или медиафайл для MAX.');
    const attachments: Attachment[] = [];
    for (const media of post.media || [])
      attachments.push(await this.upload(media, credentials.token));
    const result = await this.api<{
      message?: { body?: { mid?: string }; url?: string };
    }>(`/messages?chat_id=${credentials.chatId}`, credentials.token, {
      text: post.message || null,
      ...(attachments.length ? { attachments } : {}),
    });
    if (!result.message?.body?.mid)
      this.fail(
        'MAX не вернул ID публикации. Проверьте канал перед повторной отправкой.'
      );
    return [
      {
        id: post.id,
        postId: result.message.body.mid,
        releaseURL: result.message.url || '',
        status: 'completed',
      },
    ];
  }
}
