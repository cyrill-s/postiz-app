import { BadBody, RefreshToken, SocialAbstract } from '../social.abstract';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const MEDIA_MESSAGE =
  'Ключ сообщества VK поддерживает здесь текст и ссылки. Удалите фото и видео: VK не разрешает их загрузку на стену с этим типом ключа.';

type Community = {
  id: number;
  name: string;
  screen_name?: string;
  photo_200?: string;
  deactivated?: string;
};

export class VkCommunityProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'vk-community';
  name = 'VK — сообщество';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  override maxConcurrentJob = 1;
  toolTip =
    'Подключите сообщество его ключом с доступом к стене. Доступны текст и ссылки; фото и видео с этим ключом не загружаются.';

  maxLength() {
    return 2048;
  }

  async customFields() {
    return [
      {
        key: 'token',
        label: 'Ключ доступа сообщества',
        type: 'password' as const,
        validation: '/^[A-Za-z0-9_.-]{20,2048}$/',
        hint: 'VK → Управление сообществом → Работа с API → Ключи доступа. Нужен доступ к стене. Не используйте сервисный или защищённый ключ приложения.',
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeId(32);
    return { state, url: state, codeVerifier: makeId(32) };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }): Promise<AuthTokenDetails | string> {
    let token: string;
    try {
      const data = JSON.parse(
        Buffer.from(params.code, 'base64').toString('utf8')
      );
      token = typeof data.token === 'string' ? data.token.trim() : '';
    } catch {
      return 'Вставьте ключ доступа сообщества и повторите подключение.';
    }
    if (!/^[A-Za-z0-9_.-]{20,2048}$/.test(token))
      return 'Некорректный ключ доступа сообщества.';

    // Encrypt the credential before storing it in Integration.token. Only this
    // provider decrypts it at the VK API boundary; it never reaches client URLs.
    const accessToken = AuthService.fixedEncryption(token);
    try {
      // This method accepts community tokens only, excluding user/service keys.
      const permissions = await this.api<{ mask: number }>(
        'groups.getTokenPermissions',
        accessToken
      );
      if ((permissions.mask & 8192) !== 8192)
        return 'У ключа нет доступа к стене. Создайте ключ с этим разрешением и подключите сообщество снова.';
      // Omit group_id: VK must identify the community owning this token. A user
      // supplied ID or public group lookup cannot prove ownership of a channel.
      const result = await this.api<{ groups: Community[] } | Community[]>(
        'groups.getById',
        accessToken
      );
      const groups = Array.isArray(result) ? result : result.groups;
      const group = groups?.[0];
      if (
        groups?.length !== 1 ||
        !Number.isSafeInteger(group?.id) ||
        group.id <= 0 ||
        group.deactivated
      ) {
        return 'Не удалось определить сообщество по ключу. Проверьте, что это действующий ключ нужного сообщества.';
      }
      return {
        id: `vk-community:${group.id}`,
        name: group.name,
        accessToken,
        refreshToken: '',
        expiresIn: 0,
        picture: group.photo_200 || '',
        username: group.screen_name || `club${group.id}`,
      };
    } catch (error) {
      if (error instanceof RefreshToken)
        return 'VK отклонил ключ. Вставьте действующий ключ сообщества с доступом к стене.';
      if (error instanceof BadBody) return error.message;
      return 'Не удалось проверить ключ в VK. Повторите подключение позже.';
    }
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    // Community keys have no refresh endpoint. Revocation requires a new key.
    return {
      id: '',
      name: '',
      accessToken: '',
      refreshToken: '',
      expiresIn: 0,
      picture: '',
      username: '',
    };
  }

  private fail(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  private groupId(channelId: string): string {
    const match = /^vk-community:([1-9]\d*)$/.exec(channelId);
    if (!match)
      this.fail('Некорректное сообщество VK. Подключите канал заново.');
    return match[1];
  }

  private async api<T>(
    method: string,
    encryptedToken: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    let token: string;
    try {
      token = AuthService.fixedDecryption(encryptedToken);
    } catch {
      this.fail('Не удалось прочитать ключ VK. Подключите сообщество заново.');
    }
    const response = await fetch(`https://api.vk.com/method/${method}`, {
      method: 'POST',
      body: new URLSearchParams({ ...params, access_token: token, v: '5.199' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`VK ${method}: HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) {
      const code = Number(data.error.error_code);
      if (code === 5)
        throw new RefreshToken(
          this.identifier,
          '{}',
          '{}',
          'Ключ VK недействителен. Подключите сообщество заново.'
        );
      // Code 27 can mean an unsupported method, not an expired token. Do not
      // disconnect a valid community key because an API method rejected group auth.
      if (code === 27)
        this.fail(
          `VK не разрешает ${method} с этим ключом. Используйте ключ сообщества для поддерживаемых действий.`
        );
      if ([1, 6, 9, 10, 29].includes(code))
        throw new Error(`VK ${method}: временная ошибка ${code}`);
      this.fail(
        `VK ${method}: ошибка ${code}. Проверьте права ключа сообщества.`
      );
    }
    if (data.response === undefined)
      this.fail(`VK ${method}: нет данных в ответе.`);
    return data.response;
  }

  override async checkValidity(posts: Array<{ path: string }[]>) {
    return posts.some((media) => media.length > 0)
      ? MEDIA_MESSAGE
      : (true as const);
  }

  private validatePost(post: PostDetails) {
    if (!post || !post.message?.trim())
      this.fail('Добавьте текст или ссылку для публикации в VK.');
    if (post.media?.length) this.fail(MEDIA_MESSAGE);
  }

  async post(
    channelId: string,
    accessToken: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    const groupId = this.groupId(channelId);
    const post = posts[0];
    this.validatePost(post);
    const result = await this.api<{ post_id: number }>(
      'wall.post',
      accessToken,
      {
        owner_id: `-${groupId}`,
        from_group: '1',
        message: post.message,
        guid: post.id,
      }
    );
    if (!Number.isSafeInteger(result.post_id) || result.post_id <= 0)
      this.fail('VK не подтвердил публикацию записи.');
    return [
      {
        id: post.id,
        postId: String(result.post_id),
        releaseURL: `https://vk.com/wall-${groupId}_${result.post_id}`,
        status: 'completed',
      },
    ];
  }

  async comment(
    channelId: string,
    postId: string,
    _lastCommentId: string | undefined,
    accessToken: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    const groupId = this.groupId(channelId);
    const post = posts[0];
    this.validatePost(post);
    const result = await this.api<{ comment_id: number }>(
      'wall.createComment',
      accessToken,
      {
        owner_id: `-${groupId}`,
        from_group: groupId,
        post_id: postId,
        message: post.message,
        guid: post.id,
      }
    );
    if (!Number.isSafeInteger(result.comment_id) || result.comment_id <= 0)
      this.fail('VK не подтвердил публикацию комментария.');
    return [
      {
        id: post.id,
        postId: String(result.comment_id),
        releaseURL: `https://vk.com/wall-${groupId}_${postId}?reply=${result.comment_id}`,
        status: 'completed',
      },
    ];
  }
}
