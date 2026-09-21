import { s3ObjectKey } from './s3.object-key';

describe('s3ObjectKey', () => {
  const originalPrefix = process.env.S3_KEY_PREFIX;

  afterEach(() => {
    if (originalPrefix === undefined) {
      delete process.env.S3_KEY_PREFIX;
    } else {
      process.env.S3_KEY_PREFIX = originalPrefix;
    }
  });

  it('preserves legacy unprefixed keys when no namespace is configured', () => {
    delete process.env.S3_KEY_PREFIX;

    expect(s3ObjectKey('image.png')).toBe('image.png');
  });

  it('normalizes the configured namespace and prefixes a bare key', () => {
    process.env.S3_KEY_PREFIX = '/postiz/';

    expect(s3ObjectKey('/image.png')).toBe('postiz/image.png');
  });

  it('does not duplicate an existing namespace', () => {
    process.env.S3_KEY_PREFIX = 'postiz/';

    expect(s3ObjectKey('postiz/image.png')).toBe('postiz/image.png');
  });
});
