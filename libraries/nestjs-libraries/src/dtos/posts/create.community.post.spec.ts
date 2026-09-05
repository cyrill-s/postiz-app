jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({ sanitizePostContent: (value: string) => value }));
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreatePostDto } from './create.post.dto';

const validate = (provider: string, type = 'now') =>
  new ValidationPipe({
    skipMissingProperties: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }).transform({
    type, date: '2026-09-06T09:00:00.000Z', shortLink: false, tags: [],
    posts: [{
      type, integration: { id: 'channel-id' }, settings: { __type: provider },
      value: [{ content: 'Проверка публикации', delay: 0, image: [] }],
    }],
  }, { type: 'body', metatype: CreatePostDto });

describe('community posts through the create endpoint validation pipe', () => {
  it.each(['ok-community', 'vk-community'])('accepts publish-now for %s', async provider => {
    await expect(validate(provider)).resolves.toMatchObject({
      type: 'now', posts: [{ settings: { __type: provider } }],
    });
  });
  it('accepts scheduled OK posts', async () => {
    await expect(validate('ok-community', 'schedule')).resolves.toMatchObject({ type: 'schedule' });
  });
  it('still rejects unknown providers', async () => {
    await expect(validate('unknown-provider')).rejects.toThrow();
  });
});
