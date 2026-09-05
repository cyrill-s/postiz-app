import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  NotEnoughScopes,
} from '../social.abstract';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import axios from 'axios';
import FormData from 'form-data';
import mime from 'mime-types';

type Community = {
  id: number;
  name: string;
  screen_name?: string;
  photo_200?: string;
  admin_level?: number;
  deactivated?: string;
};

// Use the already registered /vk callback. The state prefix routes the callback
// to this provider; the full random state is still verified against Redis.
export class VkCommunityProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'vk-community';
  name = 'VK — сообщество';
  isBetweenSteps = true;
  scopes = ['wall', 'photos', 'video', 'groups', 'offline'];
  editor = 'normal' as const;
  override maxConcurrentJob = 1;
  toolTip =
    'Войдите в VK и выберите сообщество, где вы администратор или редактор. Каждое сообщество добавляется отдельным каналом.';

  maxLength() {
    return 2048;
  }

  private callbackUrl() {
    return `${process.env.FRONTEND_URL}/integrations/social/vk`;
  }

  async generateAuthUrl() {
    const state = `vk-community-${makeId(32)}`;
    const codeVerifier = makeId(32);
    if (!process.env.VK_COMMUNITY_ID || !process.env.VK_COMMUNITY_SECRET) {
      const errorUrl = new URL(
        `${process.env.FRONTEND_URL}/integrations/social/vk-community`
      );
      errorUrl.searchParams.set('error', 'configuration');
      errorUrl.searchParams.set(
        'error_description',
        'Для подключения сообществ нужно настроить приложение VK API с правами публикации. Текущее приложение VK ID поддерживает только вход. Обратитесь к администратору Postiz.'
      );
      return { url: errorUrl.toString(), state, codeVerifier };
    }
    const url = new URL('https://oauth.vk.com/authorize');
    url.search = new URLSearchParams({
      client_id: process.env.VK_COMMUNITY_ID,
      redirect_uri: this.callbackUrl(),
      response_type: 'code',
      scope: this.scopes.join(','),
      state,
      v: '5.199',
      display: 'page',
    }).toString();
    return { state, codeVerifier, url: url.toString() };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const response = await fetch('https://oauth.vk.com/access_token', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      body: new URLSearchParams({
        client_id: process.env.VK_COMMUNITY_ID || '',
        client_secret: process.env.VK_COMMUNITY_SECRET || '',
        redirect_uri: this.callbackUrl(),
        code: params.code,
      }),
    });
    const auth = await response.json();
    if (!response.ok || auth.error || !auth.access_token) {
      throw new NotEnoughScopes(
        'Не удалось получить доступ VK API. Проверьте настройки приложения и повторите вход.'
      );
    }
    // VK ID tokens can read public profiles but cannot publish. Fail before
    // saving a channel if VK did not grant the actual publishing permissions.
    const permissions = await this.api<number>(
      'account.getAppPermissions',
      auth.access_token
    );
    const required = 8192 | 262144 | 4 | 16; // wall, groups, photos, video
    if ((permissions & required) !== required) {
      throw new NotEnoughScopes(
        'Разрешите приложению доступ к сообществам, стене, фото и видео, затем повторите вход.'
      );
    }
    const users = await this.api<
      {
        id: number;
        first_name: string;
        last_name: string;
        photo_200?: string;
      }[]
    >('users.get', auth.access_token, { fields: 'photo_200' });
    const user = users[0];
    if (!user?.id)
      throw new NotEnoughScopes(
        'VK не вернул профиль пользователя. Повторите вход.'
      );
    // Postiz keys integrations by organization + internalId, across providers.
    // Never overwrite a personal VK channel with the temporary selection row.
    return {
      id: `vk-community-user:${user.id}`,
      name: `${user.first_name} ${user.last_name}`,
      accessToken: auth.access_token,
      refreshToken: '',
      expiresIn: Number(auth.expires_in) || 0,
      picture: user.photo_200 || '',
      username: `id${user.id}`,
    };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    // Legacy VK offline tokens have no refresh-token endpoint. On revocation,
    // Postiz marks the channel for reconnect rather than reusing an invalid token.
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
    token: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    // Do not put credentials in URLs or serialize VK request_params into errors.
    const response = await fetch(`https://api.vk.com/method/${method}`, {
      method: 'POST',
      body: new URLSearchParams({ ...params, access_token: token, v: '5.199' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`VK ${method}: HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) {
      const code = Number(data.error.error_code);
      if (code === 5 || code === 27) {
        throw new RefreshToken(
          this.identifier,
          '{}',
          '{}',
          'Доступ VK истёк. Подключите сообщество заново.'
        );
      }
      if ([1, 6, 9, 10, 29].includes(code))
        throw new Error(`VK ${method}: временная ошибка ${code}`);
      this.fail(
        `VK ${method}: ошибка ${code}. Проверьте права доступа к сообществу и разрешения приложения.`
      );
    }
    if (data.response === undefined)
      this.fail(`VK ${method}: нет данных в ответе.`);
    return data.response;
  }

  async pages(accessToken: string) {
    const groups: Community[] = [];
    let offset = 0;
    while (true) {
      const page = await this.api<{ count: number; items: Community[] }>(
        'groups.get',
        accessToken,
        {
          filter: 'editor',
          extended: '1',
          fields: 'admin_level',
          count: '1000',
          offset: String(offset),
        }
      );
      groups.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.count) break;
    }
    return groups
      .filter((g) => !g.deactivated && (g.admin_level ?? 0) >= 2)
      .map((g) => ({
        id: `vk-community:${g.id}`,
        name: g.name,
        picture: g.photo_200 || '',
        username: g.screen_name || `club${g.id}`,
      }));
  }

  async fetchPageInformation(accessToken: string, params: { page: string }) {
    const id = this.groupId(params.page);
    const result = await this.api<{ groups: Community[] } | Community[]>(
      'groups.getById',
      accessToken,
      {
        group_id: id,
        fields: 'admin_level',
      }
    );
    const group = (Array.isArray(result) ? result : result.groups)?.[0];
    if (
      !group ||
      String(group.id) !== id ||
      group.deactivated ||
      (group.admin_level ?? 0) < 2
    ) {
      this.fail(
        'Нужны права администратора или редактора этого сообщества. Проверьте права и подключите канал заново.'
      );
    }
    return {
      id: `vk-community:${group.id}`,
      name: group.name,
      access_token: accessToken,
      picture: group.photo_200 || '',
      username: group.screen_name || `club${group.id}`,
    };
  }

  async reConnect(_id: string, requiredId: string, accessToken: string) {
    const group = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });
    return {
      id: group.id,
      name: group.name,
      accessToken,
      picture: group.picture,
      username: group.username,
    };
  }

  override async checkValidity(posts: Array<{ path: string }[]>) {
    if (posts.some((media) => media.length > 10))
      return 'К записи VK можно прикрепить не больше 10 файлов.';
    return true as const;
  }

  private async communityMedia(
    groupId: string,
    token: string,
    post: PostDetails
  ): Promise<string[]> {
    if ((post.media?.length ?? 0) > 10)
      this.fail('К записи VK можно прикрепить не больше 10 файлов.');
    const attachments: string[] = [];
    // Stream one file at a time to keep the worker inside its VPS memory limit.
    for (const media of post.media || []) {
      const video = media.type === 'video';
      const upload = await this.api<{
        upload_url: string;
        owner_id?: number;
        video_id?: number;
        access_key?: string;
      }>(video ? 'video.save' : 'photos.getWallUploadServer', token, {
        group_id: groupId,
        ...(video ? { wallpost: '0' } : {}),
      });
      const { data: stream } = await axios.get(media.path, {
        responseType: 'stream',
        timeout: 60000,
      });
      const form = new FormData();
      const filename =
        new URL(media.path).pathname.split('/').pop() ||
        (video ? 'video.mp4' : 'photo.jpg');
      form.append(video ? 'video_file' : 'photo', stream, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream',
      });
      let saved;
      try {
        ({ data: saved } = await axios.post(upload.upload_url, form, {
          headers: form.getHeaders(),
          maxBodyLength: Infinity,
          timeout: 600000,
        }));
      } catch {
        // Axios errors include the signed upload URL. Keep it out of workflow history.
        throw new Error(
          'Не удалось загрузить файл в VK. Повторите публикацию.'
        );
      } finally {
        stream.destroy();
      }
      if (saved?.error)
        this.fail(
          'VK отклонил загрузку файла. Проверьте формат и права доступа.'
        );
      if (video) {
        if (!upload.owner_id || !upload.video_id || !saved?.video_id)
          this.fail('VK не подтвердил загрузку видео.');
        attachments.push(
          `video${upload.owner_id}_${upload.video_id}${
            upload.access_key ? `_${upload.access_key}` : ''
          }`
        );
      } else {
        const photos = await this.api<
          { id: number; owner_id: number; access_key?: string }[]
        >('photos.saveWallPhoto', token, {
          group_id: groupId,
          photo: saved.photo,
          server: String(saved.server),
          hash: saved.hash,
        });
        const photo = photos[0];
        if (!photo?.id || !photo.owner_id)
          this.fail('VK не подтвердил сохранение фото.');
        attachments.push(
          `photo${photo.owner_id}_${photo.id}${
            photo.access_key ? `_${photo.access_key}` : ''
          }`
        );
      }
    }
    return attachments;
  }

  async post(
    channelId: string,
    accessToken: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    const groupId = this.groupId(channelId);
    const post = posts[0];
    const attachments = await this.communityMedia(groupId, accessToken, post);
    const result = await this.api<{ post_id: number }>(
      'wall.post',
      accessToken,
      {
        owner_id: `-${groupId}`,
        from_group: '1',
        message: post.message,
        attachments: attachments.join(','),
        guid: post.id,
      }
    );
    if (!result.post_id) this.fail('VK не подтвердил публикацию записи.');
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
    const attachments = await this.communityMedia(groupId, accessToken, post);
    const result = await this.api<{ comment_id: number }>(
      'wall.createComment',
      accessToken,
      {
        owner_id: `-${groupId}`,
        from_group: groupId,
        post_id: postId,
        message: post.message,
        attachments: attachments.join(','),
        guid: post.id,
      }
    );
    if (!result.comment_id)
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
