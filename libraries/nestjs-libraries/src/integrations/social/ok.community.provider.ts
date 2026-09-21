import { createHash } from 'crypto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { BadBody, RefreshToken, SocialAbstract } from '../social.abstract';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';

type Credentials = {
  applicationKey: string;
  token: string;
  sessionSecret: string;
  groupId: string;
};
const IMAGE_LIMIT = 10 * 1024 * 1024;
const MEDIA_NOTICE =
  'Одноклассники: до 10 фотографий JPG или PNG, до 10 МБ каждая. Видео пока не поддерживается.';
const numericId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);

export class OkCommunityProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'ok-community';
  name = 'Одноклассники — группа';
  isBetweenSteps = false;
  scopes: string[] = [];
  editor = 'normal' as const;
  override maxConcurrentJob = 1;
  toolTip =
    'Отдельный канал для каждой группы. Нужны ключ приложения и токен администратора и секретный ключ приложения.';
  maxLength() {
    return 10000;
  }

  async customFields() {
    return [
      {
        key: 'groupId',
        label: 'ID группы',
        type: 'text' as const,
        validation: '/^[1-9][0-9]{0,19}$/',
        hint: 'Число из ссылки ok.ru/group/70000035141015. Каждая группа подключается отдельно.',
      },
      {
        key: 'applicationKey',
        label: 'Публичный ключ приложения',
        type: 'text' as const,
        validation: '/^[A-Za-z0-9_-]{5,256}$/',
        hint: 'application_key из письма с данными приложения OK. Это не ID приложения.',
      },
      {
        key: 'token',
        label: 'Токен доступа (access_token)',
        type: 'password' as const,
        validation: '/^[^\\s]{10,4096}$/',
        hint: 'Настройки приложения → Вечный access_token. Ключ из раздела сообщений группы не подходит.',
      },
      {
        key: 'applicationSecret',
        label: 'Секретный ключ приложения',
        type: 'password' as const,
        validation: '/^[^\\s]{10,4096}$/',
        hint: 'Из письма с данными приложения OK. Используется для вычисления секрета сессии; сам ключ приложения не сохраняется.',
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeId(32);
    return { state, url: state, codeVerifier: makeId(32) };
  }

  private validCredentials(data: Credentials) {
    return (
      data &&
      numericId(data.groupId) &&
      /^[A-Za-z0-9_-]{5,256}$/.test(data.applicationKey || '') &&
      typeof data.token === 'string' &&
      /^\S{10,4096}$/.test(data.token) &&
      /^[a-fA-F0-9]{32}$/.test(data.sessionSecret || '')
    );
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
      credentials = Object.fromEntries(
        ['groupId', 'applicationKey', 'token', 'sessionSecret'].map((key) => [
          key,
          typeof data[key] === 'string' ? data[key].trim() : '',
        ])
      ) as Credentials;
      if (typeof data.applicationSecret === 'string') {
        const applicationSecret = data.applicationSecret.trim();
        if (!/^\S{10,4096}$/.test(applicationSecret))
          return 'Проверьте секретный ключ приложения из письма OK.';
        credentials.sessionSecret = createHash('md5')
          .update(credentials.token + applicationSecret)
          .digest('hex');
      }
      if (!this.validCredentials(credentials))
        return 'Проверьте ID группы, публичный ключ приложения и токен и секретный ключ приложения.';
    } catch {
      return 'Заполните данные приложения и группы.';
    }
    const accessToken = AuthService.fixedEncryption(
      JSON.stringify(credentials)
    );
    try {
      const user = await this.api<{ uid: string }>(
        'users.getCurrentUser',
        accessToken,
        { fields: 'uid' }
      );
      if (!numericId(user?.uid)) return 'OK не подтвердил пользователя токена.';
      for (const permission of ['VALUABLE_ACCESS', 'GROUP_CONTENT']) {
        if (
          (await this.api<boolean>('users.hasAppPermission', accessToken, {
            ext_perm: permission,
          })) !== true
        )
          return `Нет разрешения ${permission}. Получите право для приложения OK и создайте новую токен и секретный ключ приложения.`;
      }
      const members = await this.api<
        Array<{ groupId: string; userId: string; status: string }>
      >('group.getUserGroupsByIds', accessToken, {
        group_id: credentials.groupId,
        uids: user.uid,
      });
      if (
        !Array.isArray(members) ||
        !members.some(
          (member) =>
            member.groupId === credentials.groupId &&
            member.userId === user.uid &&
            ['ADMIN', 'MODERATOR'].includes(member.status)
        )
      )
        return 'Владелец токена должен быть администратором или модератором этой группы.';
      const groups = await this.api<
        Array<{ uid: string; name: string; picAvatar?: string }>
      >('group.getInfo', accessToken, {
        uids: credentials.groupId,
        fields: 'uid,name,pic_avatar',
      });
      const group =
        Array.isArray(groups) &&
        groups.find((item) => item.uid === credentials.groupId);
      if (!group || !group.name)
        return 'Не удалось получить данные выбранной группы.';
      return {
        id: `ok-community:${credentials.groupId}`,
        name: group.name,
        accessToken,
        refreshToken: '',
        expiresIn: 0,
        picture: group.picAvatar || '',
        username: `group/${credentials.groupId}`,
      };
    } catch (error) {
      if (error instanceof BadBody || error instanceof RefreshToken)
        return error.message;
      return 'Не удалось проверить доступ в OK. Повторите подключение позже.';
    }
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

  private fail(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  private credentials(encrypted: string): Credentials {
    try {
      const data = JSON.parse(AuthService.fixedDecryption(encrypted));
      if (this.validCredentials(data)) return data;
    } catch {}
    this.fail('Не удалось прочитать ключи OK. Подключите группу заново.');
  }

  private async api<T>(
    method: string,
    encrypted: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const credentials = this.credentials(encrypted);
    const fields: Record<string, string> = {
      ...params,
      application_key: credentials.applicationKey,
      format: 'json',
      method,
    };
    const signature = createHash('md5')
      .update(
        Object.keys(fields)
          .sort()
          .map((key) => `${key}=${fields[key]}`)
          .join('') + credentials.sessionSecret
      )
      .digest('hex');
    let response: Response;
    let data: any;
    try {
      response = await fetch('https://api.ok.ru/fb.do', {
        method: 'POST',
        body: new URLSearchParams({
          ...fields,
          sig: signature,
          access_token: credentials.token,
        }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      data = await response.json();
    } catch {
      // OK documents no idempotency key for mediatopic.post. An ambiguous result
      // must not trigger an automatic retry that could duplicate a public post.
      if (method === 'mediatopic.post')
        this.fail(
          'OK не подтвердил результат. Проверьте ленту группы перед повторной публикацией: запись могла появиться.'
        );
      throw new Error(`OK ${method}: соединение недоступно`);
    }
    if (data?.error_code !== undefined) {
      const code = Number(data.error_code);
      if ([102, 103].includes(code))
        throw new RefreshToken(
          this.identifier,
          '{}',
          '{}',
          'Токен OK недействителен. Подключите группу с новым токеном и ключом приложения.'
        );
      this.fail(
        `OK: ошибка ${code}. Проверьте права приложения и доступ администратора группы.`
      );
    }
    if (!response.ok)
      this.fail(
        `OK: HTTP ${response.status}. Проверьте ленту перед повторной публикацией.`
      );
    return data as T;
  }

  override async checkValidity(posts: Array<{ path: string }[]>) {
    return posts.some(
      (media) =>
        media.length > 10 ||
        media.some((item) => !/\.(jpe?g|png)(?:[?#]|$)/i.test(item.path))
    )
      ? MEDIA_NOTICE
      : (true as const);
  }

  private async uploadPhoto(encrypted: string, groupId: string, path: string) {
    let source: URL;
    try {
      source = new URL(path);
    } catch {
      this.fail('Не удалось открыть фотографию. Загрузите её в Postiz заново.');
    }
    if (source.protocol !== 'https:' || source.username || source.password)
      this.fail('Для фотографии нужен адрес HTTPS.');
    const response = await fetch(source, {
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
      dispatcher: getSsrfSafeDispatcher(),
    } as RequestInit);
    if (!response.ok || !response.body)
      this.fail('Не удалось загрузить фотографию из Postiz.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > IMAGE_LIMIT) this.fail(MEDIA_NOTICE);
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpeg && !png) this.fail(MEDIA_NOTICE);
    const upload = await this.api<{ upload_url: string; photo_ids: string[] }>(
      'photosV2.getUploadUrl',
      encrypted,
      { gid: groupId, count: '1', sizes: String(size) }
    );
    let target: URL;
    try {
      target = new URL(upload.upload_url);
    } catch {
      this.fail('OK не вернул адрес загрузки фотографии.');
    }
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      !['ok.ru', 'okcdn.ru', 'mycdn.me', 'odnoklassniki.ru'].some(
        (host) =>
          target.hostname === host || target.hostname.endsWith(`.${host}`)
      )
    )
      this.fail('OK вернул неподдерживаемый адрес загрузки фотографии.');
    const form = new FormData();
    form.append(
      'pic1',
      new Blob([new Uint8Array(bytes)], {
        type: jpeg ? 'image/jpeg' : 'image/png',
      }),
      jpeg ? 'photo.jpg' : 'photo.png'
    );
    let result: any;
    try {
      const sent = await fetch(target, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000),
        redirect: 'error',
        dispatcher: getSsrfSafeDispatcher(),
      } as RequestInit);
      if (!sent.ok) this.fail('OK отклонил загрузку фотографии.');
      result = await sent.json();
    } catch {
      this.fail('Не удалось загрузить фотографию в OK. Повторите попытку.');
    }
    const photos =
      result?.photos &&
      (Object.values(result.photos) as Array<{ token?: string }>);
    if (
      !photos ||
      photos.length !== 1 ||
      typeof photos[0].token !== 'string' ||
      !photos[0].token
    )
      this.fail('OK не подтвердил загрузку фотографии.');
    return { id: photos[0].token };
  }

  async post(
    channelId: string,
    encrypted: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    const credentials = this.credentials(encrypted);
    if (channelId !== `ok-community:${credentials.groupId}`)
      this.fail(
        'Ключи OK не принадлежат выбранному каналу. Подключите группу заново.'
      );
    if (posts.length !== 1)
      this.fail(
        'Одноклассники: публикуйте одну запись без цепочки комментариев.'
      );
    const post = posts[0];
    if (!post.message?.trim() && !post.media?.length)
      this.fail('Добавьте текст или фотографию.');
    if ((post.message || '').length > this.maxLength())
      this.fail('Сократите текст до 10 000 символов.');
    if (post.poll) this.fail('Опросы в Одноклассниках пока не поддерживаются.');
    const valid = await this.checkValidity([post.media || []]);
    if (valid !== true) this.fail(valid);
    const media: any[] = [];
    if (post.message?.trim()) media.push({ type: 'text', text: post.message });
    if (post.media?.length) {
      if (
        (await this.api<boolean>('users.hasAppPermission', encrypted, {
          ext_perm: 'PHOTO_CONTENT',
        })) !== true
      )
        this.fail(
          'Для фотографий нужно разрешение PHOTO_CONTENT. Получите его и обновите токен OK.'
        );
      const list = [];
      // Sequential uploads bound peak memory on the shared VPS.
      for (const photo of post.media)
        list.push(
          await this.uploadPhoto(encrypted, credentials.groupId, photo.path)
        );
      media.push({ type: 'photo', list });
    }
    const id = await this.api<string>('mediatopic.post', encrypted, {
      gid: credentials.groupId,
      type: 'GROUP_THEME',
      attachment: JSON.stringify({ media, onBehalfOfGroup: 'true' }),
      text_link_preview: 'true',
    });
    if (!numericId(id))
      this.fail(
        'OK не вернул ID записи. Проверьте ленту группы перед повторной публикацией.'
      );
    return [
      {
        id: post.id,
        postId: id,
        releaseURL: `https://ok.ru/group/${credentials.groupId}/topic/${id}`,
        status: 'completed',
      },
    ];
  }
}
