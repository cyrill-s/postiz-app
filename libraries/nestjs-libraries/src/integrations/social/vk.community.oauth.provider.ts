import { createHash, randomBytes } from 'node:crypto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import {
  BadBody,
  NotEnoughScopes,
  RefreshToken,
  SocialAbstract,
} from '../social.abstract';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';

const REQUIRED_SCOPES = ['wall', 'photos'];
const IMAGE_PATH = /\.(?:jpe?g|png)(?:[?#]|$)/i;
const MAX_IMAGE_SIZE = 10_000_000;
const VK_API = 'https://api.vk.ru/method/';

type Publisher = { group: string; user: number; accessToken: string };
type Refresh = {
  group: string;
  user: number;
  app: string;
  device: string;
  refreshToken: string;
};
type OAuthToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number;
  scope: string;
  state: string;
};
type Community = {
  id: number;
  name: string;
  screen_name: string;
  photo_200?: string;
};

export class VkCommunityOAuthProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'vk-community-oauth';
  name = 'VK — сообщество (VK ID)';
  reconnectOnly = true;
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = REQUIRED_SCOPES;
  refreshCron = true;
  override maxConcurrentJob = 1;

  maxLength() {
    return 2048;
  }

  private clientId() {
    const id = process.env.VK_COMMUNITY_OAUTH_CLIENT_ID;
    if (!id || !/^\d+$/.test(id)) {
      throw new NotEnoughScopes('VK ID для сообществ не настроен.');
    }
    return id;
  }

  private redirectUri() {
    return new URL(
      '/integrations/social/vk-community-oauth',
      process.env.FRONTEND_URL
    ).href;
  }

  private groupFromChannel(id = '') {
    return /^(?:vk-community|vk-community-oauth):([1-9]\d*)$/.exec(id)?.[1];
  }

  async generateAuthUrl() {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const authorize = new URL('https://id.vk.ru/authorize');
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      scope: this.scopes.join(' '),
      prompt: 'consent',
    }).toString();

    return { url: authorize.href, codeVerifier, state };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    state?: string;
    reconnectId?: string;
  }): Promise<AuthTokenDetails> {
    const group = this.groupFromChannel(params.reconnectId);
    const [code, device] = params.code.split('&&&&');
    if (!group || !code || !device || !params.state) {
      throw new NotEnoughScopes(
        'Начните переподключение из настроек существующего канала ВК.'
      );
    }

    const app = this.clientId();
    const tokens = await this.exchange({
      grant_type: 'authorization_code',
      client_id: app,
      redirect_uri: this.redirectUri(),
      code,
      code_verifier: params.codeVerifier,
      device_id: device,
      state: params.state,
    });
    if (!Number.isSafeInteger(tokens.user_id)) {
      throw new NotEnoughScopes('VK ID не подтвердил аккаунт.');
    }

    const user = Number(tokens.user_id);
    const token = tokens.access_token;
    let metadata: Community | undefined;
    try {
      // Public wall.get is not enough: only managers can read postponed posts.
      await this.api('wall.get', token, {
        owner_id: '-' + group,
        filter: 'postponed',
        count: '1',
      });
      await this.api('photos.getWallUploadServer', token, { group_id: group });
      const data = await this.api<{ groups: Community[] }>(
        'groups.getById',
        token,
        {
          group_ids: group,
        }
      );
      metadata = data.groups?.find((entry) => entry?.id === Number(group));
    } catch {
      throw new NotEnoughScopes(
        'Войдите в VK ID под аккаунтом, который управляет стеной этого сообщества и может загружать фотографии.'
      );
    }
    if (!metadata?.name || !metadata.screen_name) {
      throw new NotEnoughScopes('VK не подтвердил сообщество.');
    }

    return {
      ...this.credentials(tokens, { app, group, user, device }),
      name: metadata.name,
      username: metadata.screen_name,
      picture: metadata.photo_200,
    };
  }

  async refreshToken(encrypted: string): Promise<AuthTokenDetails> {
    const prior: Refresh = JSON.parse(AuthService.fixedDecryption(encrypted));
    if (
      !prior.refreshToken ||
      !prior.device ||
      !prior.group ||
      prior.app !== this.clientId()
    ) {
      throw new Error('Переподключите VK ID для сообщества.');
    }
    const tokens = await this.exchange({
      grant_type: 'refresh_token',
      client_id: prior.app,
      redirect_uri: this.redirectUri(),
      refresh_token: prior.refreshToken,
      device_id: prior.device,
      state: randomBytes(32).toString('base64url'),
      scope: this.scopes.join(' '),
    });
    if (tokens.user_id !== undefined && tokens.user_id !== prior.user) {
      throw new Error('VK ID вернул другой аккаунт.');
    }
    return this.credentials(tokens, prior);
  }

  private async exchange(params: Record<string, string>): Promise<OAuthToken> {
    const response = await fetch('https://id.vk.ru/oauth2/auth', {
      method: 'POST',
      body: new URLSearchParams(params),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new NotEnoughScopes('VK ID не выдал токен.');
    const token: Partial<OAuthToken> = await response.json();
    if (
      !token.access_token ||
      !token.refresh_token ||
      !Number.isSafeInteger(token.expires_in) ||
      Number(token.expires_in) <= 0 ||
      token.state !== params.state ||
      !this.scopes.every((scope) => token.scope?.split(/\s+/).includes(scope))
    ) {
      throw new NotEnoughScopes('VK ID не подтвердил права wall и photos.');
    }
    return token as OAuthToken;
  }

  private credentials(
    tokens: OAuthToken,
    { group, user, app, device }: Omit<Refresh, 'refreshToken'>
  ): AuthTokenDetails {
    return {
      id: 'vk-community-oauth:' + group,
      name: '',
      username: '',
      accessToken: AuthService.fixedEncryption(
        JSON.stringify({ group, user, accessToken: tokens.access_token })
      ),
      refreshToken: AuthService.fixedEncryption(
        JSON.stringify({
          group,
          user,
          app,
          device,
          refreshToken: tokens.refresh_token,
        })
      ),
      expiresIn: tokens.expires_in,
    };
  }

  private fail(message: string): never {
    throw new BadBody(this.identifier, '{}', '{}', message);
  }

  private async api<T>(
    method: string,
    token: string,
    params: Record<string, string>
  ): Promise<T> {
    const response = await fetch(VK_API + method, {
      method: 'POST',
      body: new URLSearchParams({ ...params, access_token: token, v: '5.199' }),
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
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
          'VK ID отклонил токен.'
        );
      if ([1, 6, 9, 10, 29].includes(code))
        throw new Error(`VK ${method}: ошибка ${code}`);
      this.fail(
        `VK ${method}: ошибка ${code}. Проверьте доступ к публикациям в сообществе.`
      );
    }
    if (data.response == null) this.fail(`VK ${method}: нет результата.`);
    return data.response as T;
  }

  async checkValidity(
    posts: Array<{ path: string }[]>
  ): Promise<true | string> {
    if (posts.length > 1)
      return 'Для этого канала ВК запись публикуется без цепочки комментариев.';
    if ((posts[0]?.length ?? 0) > 10)
      return 'Прикрепите не более 10 фотографий.';
    return posts.flat().every(({ path }) => IMAGE_PATH.test(path))
      ? true
      : 'Прикрепите фотографию в формате JPG или PNG.';
  }

  private async uploadPhoto(publisher: Publisher, path: string) {
    const { group, user, accessToken } = publisher;
    const url = new URL(path, process.env.FRONTEND_URL);
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
      dispatcher: getSsrfSafeDispatcher(),
    } as RequestInit);
    if (!response.ok || !response.body)
      this.fail('Не удалось прочитать фотографию в Postiz.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_IMAGE_SIZE)
          this.fail('Фотография должна быть меньше 10 МБ.');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    if (!jpeg && !png)
      this.fail('Прикрепите фотографию в формате JPG или PNG.');

    const { upload_url } = await this.api<{ upload_url: string }>(
      'photos.getWallUploadServer',
      accessToken,
      {
        group_id: group,
      }
    );
    const target = URL.canParse(upload_url) ? new URL(upload_url) : null;
    if (
      !target ||
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.port ||
      !['vk.ru', 'vk.com', 'userapi.com', 'vkuserphoto.ru'].some((host) =>
        target.hostname.endsWith('.' + host)
      )
    ) {
      this.fail('VK вернул неподдерживаемый адрес загрузки фотографии.');
    }

    const form = new FormData();
    form.append(
      'photo',
      new Blob([new Uint8Array(bytes)], {
        type: jpeg ? 'image/jpeg' : 'image/png',
      }),
      jpeg ? 'photo.jpg' : 'photo.png'
    );
    const uploaded = await fetch(target, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      dispatcher: getSsrfSafeDispatcher(),
    } as RequestInit);
    if (!uploaded.ok) this.fail('VK отклонил загрузку фотографии.');
    const { server, photo, hash } = await uploaded.json();
    if (!server || !photo || photo === '[]' || !hash)
      this.fail('VK не принял фотографию.');

    const [saved] = await this.api<Array<{ id: number; owner_id: number }>>(
      'photos.saveWallPhoto',
      accessToken,
      {
        group_id: group,
        photo,
        hash,
        server: String(server),
      }
    );
    if (
      !saved ||
      !Number.isSafeInteger(saved.id) ||
      saved.id <= 0 ||
      ![user, -Number(group)].includes(saved.owner_id)
    ) {
      this.fail('VK не подтвердил сохранение фотографии.');
    }
    // VK can save the source under the authenticated user and clone it to the community on publish.
    return `photo${saved.owner_id}_${saved.id}`;
  }

  async post(
    channelId: string,
    encrypted: string,
    posts: PostDetails[]
  ): Promise<PostResponse[]> {
    const publisher: Publisher = JSON.parse(
      AuthService.fixedDecryption(encrypted)
    );
    const group = this.groupFromChannel(channelId);
    if (!group || publisher.group !== group) {
      this.fail('VK ID подключён к другому сообществу.');
    }
    const [post] = posts;
    if (!post || (!post.message.trim() && !post.media?.length)) {
      this.fail('Добавьте текст или фотографию.');
    }
    const valid = await this.checkValidity(
      posts.map(({ media }) => media ?? [])
    );
    if (valid !== true) this.fail(valid);
    if (post.media?.some((media) => media.type !== 'image'))
      this.fail('Прикрепите фотографию в формате JPG или PNG.');

    const attachments = [];
    for (const image of post.media ?? []) {
      attachments.push(await this.uploadPhoto(publisher, image.path));
    }

    const result = await this.api<{ post_id: number }>(
      'wall.post',
      publisher.accessToken,
      {
        owner_id: '-' + publisher.group,
        from_group: '1',
        signed: '0',
        message: post.message,
        attachments: attachments.join(','),
        guid: post.id,
      }
    );
    if (!Number.isSafeInteger(result.post_id) || result.post_id <= 0) {
      this.fail('VK не подтвердил публикацию записи.');
    }
    return [
      {
        id: post.id,
        postId: String(result.post_id),
        releaseURL: `https://vk.ru/wall-${publisher.group}_${result.post_id}`,
        status: 'completed',
      },
    ];
  }
}
