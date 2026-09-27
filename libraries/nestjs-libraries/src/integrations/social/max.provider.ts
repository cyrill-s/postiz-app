import { compileSocialContent } from '@gitroom/helpers/utils/social-formatting';
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
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';
import FormDataUpload from 'form-data';
import { PassThrough } from 'stream';
import dayjs from 'dayjs';

const API = 'https://platform-api2.max.ru';
const MEDIA_NOTICE =
  'MAX: до 10 изображений или видео. Изображение — до 50 МБ, видео — до 250 МБ.';
type Credentials = { chatId: string; token: string };
type JulsCredentials = { chatId: string; tokenSource: 'juls' };
type StoredCredentials = Credentials | JulsCredentials;
type Attachment = { type: 'image' | 'video'; payload: Record<string, unknown> };
type MaxMessage = {
  recipient: { chat_id: number | string; chat_type: string };
  timestamp: number;
  body: { mid: string } | null;
  stat?: { views?: number } | null;
  url?: string;
};
const COMMENT_NOTICE =
  'MAX: комментарии поддерживают только текст, без фото и видео.';

export class MaxProvider extends SocialAbstract implements SocialProvider {
  identifier = 'max';
  name = 'MAX';
  isBetweenSteps = false;
  scopes: string[] = [];
  editor = 'normal' as const;
  override maxConcurrentJob = 1;
  toolTip =
    'Посты, комментарии и статистика канала MAX через бота с правами чтения и публикации.';

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
        hint: 'Добавьте бота администратором с правами чтения и публикации. Для комментариев включите их в настройках канала. Укажите chat_id из события bot_added вашего бота.',
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

  private validChatId(chatId: unknown): chatId is string {
    return (
      typeof chatId === 'string' &&
      /^-?[1-9][0-9]{0,15}$/.test(chatId) &&
      Number.isSafeInteger(Number(chatId))
    );
  }

  private resolveCredentials(data: StoredCredentials): Credentials | null {
    if (!data || !this.validChatId(data.chatId)) return null;
    if ('token' in data) return this.validCredentials(data) ? data : null;
    const token = process.env.JULS_MAX_BOT_TOKEN;
    if (
      data.tokenSource !== 'juls' ||
      typeof token !== 'string' ||
      !/^\S{1,4096}$/.test(token)
    )
      return null;
    return { chatId: data.chatId, token };
  }

  private fail(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  private credentials(id: string, accessToken: string): Credentials {
    let stored: StoredCredentials;
    try {
      stored = JSON.parse(AuthService.fixedDecryption(accessToken));
    } catch {
      this.fail('Подключите канал MAX заново.');
    }
    const credentials = this.resolveCredentials(stored);
    if (!credentials || id !== `max:${credentials.chatId}`)
      this.fail('Данные подключения MAX не соответствуют каналу.');
    return credentials;
  }

  private messageId(id: string): string {
    if (typeof id !== 'string' || !/^(mid\.)?[a-zA-Z0-9_-]+$/.test(id))
      this.fail('Некорректный ID публикации MAX.');
    return encodeURIComponent(id);
  }

  private async readPost(credentials: Credentials, postId: string) {
    const result = await this.api<{ messages: MaxMessage[] }>(
      `/messages?message_ids=${this.messageId(postId)}`,
      credentials.token
    );
    const message = result.messages?.find((item) => item.body?.mid === postId);
    if (
      !message ||
      String(message.recipient?.chat_id) !== credentials.chatId ||
      message.recipient?.chat_type !== 'channel'
    )
      this.fail('Публикация MAX не найдена в подключённом канале.');
    return message;
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
      const details = await this.verifyChannel(
        credentials.chatId,
        credentials.token
      );
      if (details === 'max_channel_invalid')
        return 'Укажите ID активного канала MAX, в который добавлен бот.';
      if (details === 'max_bot_publish_permission_missing')
        return 'Назначьте бота администратором канала с правом публикации и повторите подключение.';
      if (typeof details === 'string') return details;
      return {
        ...details,
        accessToken: AuthService.fixedEncryption(JSON.stringify(credentials)),
      };
    } catch (error) {
      if (error instanceof BadBody || error instanceof RefreshToken)
        return error.message;
      return 'Не удалось проверить доступ к MAX. Повторите подключение позже.';
    }
  }

  async authenticateJulsChannel(input: {
    chatId: string;
    maxUserId: string;
  }): Promise<AuthTokenDetails | string> {
    const token = process.env.JULS_MAX_BOT_TOKEN;
    if (!token || !/^\S{1,4096}$/.test(token)) return 'max_bot_not_configured';
    if (
      !this.validChatId(input.chatId) ||
      !/^[1-9][0-9]{0,15}$/.test(input.maxUserId) ||
      !Number.isSafeInteger(Number(input.maxUserId))
    )
      return 'max_channel_invalid';
    try {
      const details = await this.verifyChannel(input.chatId, token);
      if (typeof details === 'string') return details;
      const admins = await this.api<{
        members?: Array<{
          user_id: number | string;
          is_owner?: boolean;
          is_admin?: boolean;
          is_bot?: boolean;
        }>;
      }>(`/chats/${input.chatId}/members/admins`, token);
      const manager = admins.members?.find(
        (member) =>
          String(member.user_id) === input.maxUserId &&
          !member.is_bot &&
          (member.is_owner || member.is_admin)
      );
      if (!manager) return 'max_user_not_channel_admin';
      return {
        ...details,
        accessToken: AuthService.fixedEncryption(
          JSON.stringify({ chatId: input.chatId, tokenSource: 'juls' })
        ),
      };
    } catch (error) {
      if (error instanceof RefreshToken) return 'max_bot_token_invalid';
      return 'max_channel_verification_failed';
    }
  }

  private async verifyChannel(
    chatId: string,
    token: string
  ): Promise<AuthTokenDetails | string> {
    const chat = await this.api<{
      chat_id: number;
      type: string;
      status: string;
      title: string;
      icon?: { url?: string };
    }>(`/chats/${chatId}`, token);
    if (
      String(chat.chat_id) !== chatId ||
      chat.type !== 'channel' ||
      chat.status !== 'active'
    ) {
      return 'max_channel_invalid';
    }
    const member = await this.api<{
      is_admin: boolean;
      is_owner: boolean;
      permissions?: string[];
    }>(`/chats/${chatId}/members/me`, token);
    if (
      !member.is_owner &&
      !(
        member.is_admin &&
        member.permissions?.some((permission) =>
          ['write', 'post_edit_delete_message'].includes(permission)
        )
      )
    ) {
      return 'max_bot_publish_permission_missing';
    }
    return {
      id: `max:${chatId}`,
      name: chat.title || 'MAX',
      accessToken: '',
      refreshToken: '',
      expiresIn: 0,
      picture: chat.icon?.url || '',
      username: '',
    };
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
      if (data.message === 'comments.comments_disabled')
        this.fail(
          'MAX: комментарии в канале выключены. Включите их в настройках канала.'
        );
      if (response.status === 403)
        this.fail(
          'Боту MAX не хватает прав. Разрешите чтение и публикацию в канале; для комментариев включите их в настройках канала.'
        );
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
    if (!posts.length) return 'Добавьте публикацию для MAX.';
    if (posts[0].length > 10) return MEDIA_NOTICE;
    if (posts.slice(1).some((post) => post.length)) return COMMENT_NOTICE;
    return true;
  }

  private content(post: PostDetails, comment = false) {
    if (!post) this.fail('Добавьте текст или медиафайл для MAX.');
    if (comment && post.media?.length) this.fail(COMMENT_NOTICE);
    const compiled =
      post.sourceHtml === undefined
        ? undefined
        : compileSocialContent('max', post.sourceHtml, undefined, { comment });
    const text = compiled?.text ?? post.message;
    if ((compiled?.length ?? Array.from(text).length) > this.maxLength())
      this.fail('MAX: не более 4000 символов в публикации или комментарии.');
    if (!text.trim() && !post.media?.length)
      this.fail('Добавьте текст или медиафайл для MAX.');
    return {
      text: (compiled?.message ?? post.message) || null,
      ...(compiled ? { format: 'html' } : {}),
    };
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
    const credentials = this.credentials(id, accessToken);
    // Temporal sends comments separately, preserving their configured delays.
    if (posts.length !== 1)
      this.fail('MAX: отправляйте комментарии отдельно от публикации.');
    const validity = await this.checkValidity(
      posts.map((post) => post.media || [])
    );
    if (validity !== true) this.fail(validity);
    const post = posts[0];
    const content = this.content(post);
    const attachments: Attachment[] = [];
    for (const media of post.media || [])
      attachments.push(await this.upload(media, credentials.token));
    const result = await this.api<{
      message?: { body?: { mid?: string }; url?: string };
    }>(`/messages?chat_id=${credentials.chatId}`, credentials.token, {
      ...content,
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

  async comment(
    id: string,
    postId: string,
    _lastCommentId: string | undefined,
    accessToken: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    const credentials = this.credentials(id, accessToken);
    if (posts.length !== 1)
      this.fail('MAX: отправляйте по одному комментарию.');
    const content = this.content(posts[0], true);
    // A shared Juls bot may administer several channels: check the target first.
    const root = await this.readPost(credentials, postId);
    const result = await this.api<{ message?: { body?: { mid?: string } } }>(
      `/messages/${this.messageId(postId)}/comments`,
      credentials.token,
      content
    );
    if (!result.message?.body?.mid)
      this.fail(
        'MAX не вернул ID комментария. Проверьте пост перед повторной отправкой.'
      );
    return [
      {
        id: posts[0].id,
        postId: result.message.body.mid,
        releaseURL: root.url || '',
        status: 'completed',
      },
    ];
  }

  private snapshot(
    label: string,
    total: number,
    description: string
  ): AnalyticsData {
    return {
      label,
      description,
      type: 'snapshot',
      percentageChange: 0,
      data: [{ total: String(total), date: dayjs().format('YYYY-MM-DD') }],
    };
  }

  private isCounter(value: unknown): value is number {
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    );
  }

  async postAnalytics(
    id: string,
    accessToken: string,
    postId: string,
    _date: number
  ): Promise<AnalyticsData[]> {
    const message = await this.readPost(
      this.credentials(id, accessToken),
      postId
    );
    return this.isCounter(message.stat?.views)
      ? [
          this.snapshot(
            'Просмотры',
            message.stat.views,
            'Всего с момента публикации. MAX не возвращает историю просмотров по дням.'
          ),
        ]
      : [];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const credentials = this.credentials(id, accessToken);
    if (!Number.isInteger(date) || date < 1 || date > 90)
      this.fail('Выберите период статистики MAX от 1 до 90 дней.');
    const now = dayjs();
    const since = now
      .subtract(date - 1, 'day')
      .startOf('day')
      .valueOf();
    const chat = await this.api<{
      chat_id: number | string;
      participants_count?: number;
    }>(`/chats/${credentials.chatId}`, credentials.token);
    if (String(chat.chat_id) !== credentials.chatId)
      this.fail('Данные статистики MAX не соответствуют каналу.');
    const messages = new Map<string, MaxMessage>();
    let before = now.valueOf();
    // MAX returns newest first. `from` is the upper bound, `to` the lower bound.
    // Keep a timestamp overlap, so a page boundary never silently loses posts.
    for (let page = 0; ; page++) {
      if (page === 100)
        this.fail(
          'MAX: слишком много публикаций. Выберите более короткий период.'
        );
      const result = await this.api<{ messages: MaxMessage[] }>(
        `/messages?chat_id=${credentials.chatId}&from=${before}&to=${since}&count=100`,
        credentials.token
      );
      if (!Array.isArray(result.messages))
        this.fail(
          'MAX не вернул статистику публикаций. Повторите запрос позже.'
        );
      let oldest = before;
      for (const message of result.messages) {
        if (
          String(message.recipient?.chat_id) !== credentials.chatId ||
          message.recipient?.chat_type !== 'channel' ||
          !message.body?.mid ||
          !Number.isSafeInteger(message.timestamp) ||
          message.timestamp < 0 ||
          message.timestamp > before
        )
          this.fail(
            'MAX вернул неполные данные статистики. Повторите запрос позже.'
          );
        oldest = Math.min(oldest, message.timestamp);
        if (message.timestamp >= since) messages.set(message.body.mid, message);
      }
      if (result.messages.length < 100 || oldest < since) break;
      if (oldest >= before)
        this.fail(
          'MAX не вернул все публикации за период. Выберите более короткий период.'
        );
      before = oldest;
    }
    const metrics: AnalyticsData[] = [];
    if (this.isCounter(chat.participants_count))
      metrics.push(
        this.snapshot(
          'Участники канала',
          chat.participants_count,
          'Текущее число участников канала. Не прирост за выбранный период.'
        )
      );
    metrics.push(
      this.snapshot(
        'Публикации',
        messages.size,
        'Посты, опубликованные в канале за выбранный период, включая публикации вне Postiz.'
      )
    );
    const posts = [...messages.values()];
    // An omitted stat is unavailable, not zero; do not show a partial total.
    if (posts.every((message) => this.isCounter(message.stat?.views)))
      metrics.push(
        this.snapshot(
          'Просмотры публикаций',
          posts.reduce((total, message) => total + message.stat!.views!, 0),
          'Накопленные просмотры постов, опубликованных за выбранный период. Не прирост просмотров за период.'
        )
      );
    return metrics;
  }
}
