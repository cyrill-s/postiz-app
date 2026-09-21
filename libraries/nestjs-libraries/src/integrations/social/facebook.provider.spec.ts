import { FacebookProvider } from './facebook.provider';
import FormDataUpload from 'form-data';

const ACCESS_TOKEN = 'facebook-page-token';
const PAGE_ID = '123456';
const MEDIA_ORIGIN = 'https://poster.example/uploads';
const integration = {} as any;

describe('Facebook media publishing', () => {
  let provider: FacebookProvider;
  let fetchMock: jest.SpyInstance;
  let graphPost: jest.Mock;

  beforeEach(() => {
    provider = new FacebookProvider();
    graphPost = jest.fn(async (url: string) => {
      if (url.includes('/photos?')) {
        return { data: { id: 'photo-id' } };
      }
      if (url.includes('/videos?')) {
        return { data: { id: 'video-id', permalink_url: '/video' } };
      }
      throw new Error(`Unexpected Graph upload: ${url}`);
    });
    jest
      .spyOn(provider as any, 'getSsrfSafeAxios')
      .mockReturnValue({ post: graphPost });
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);

        if (url.startsWith(MEDIA_ORIGIN)) {
          return new Response(Uint8Array.from([1, 2, 3, 4]), {
            headers: { 'content-length': '4' },
          });
        }
        if (url.includes('/feed?')) {
          return Response.json({
            id: `${PAGE_ID}_post-id`,
            permalink_url: 'https://facebook.example/post-id',
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('uploads an image as multipart bytes instead of asking Meta to fetch its URL', async () => {
    const mediaPath = `${MEDIA_ORIGIN}/photo.png`;

    await provider.post(
      PAGE_ID,
      ACCESS_TOKEN,
      [
        {
          id: 'post-1',
          message: 'Image post',
          settings: {},
          media: [{ path: mediaPath, type: 'image' }],
        },
      ],
      integration
    );

    expect(fetchMock.mock.calls[0][0]).toBe(mediaPath);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(fetchMock.mock.calls[1][0]).toBe(mediaPath);
    const [, body, options] = graphPost.mock.calls[0];
    expect(body).toBeInstanceOf(FormDataUpload);
    expect(options.headers['content-type']).toContain('multipart/form-data');
    expect((body as any)._streams.join('')).toContain('name="source"');
    expect((body as any)._streams.join('')).toContain('name="published"');
    expect((body as any)._streams.join('')).toContain('false');
  });

  it('uploads a video as multipart bytes instead of asking Meta to fetch its URL', async () => {
    const mediaPath = `${MEDIA_ORIGIN}/video.mp4`;

    await provider.post(
      PAGE_ID,
      ACCESS_TOKEN,
      [
        {
          id: 'post-2',
          message: 'Video post',
          settings: {},
          media: [{ path: mediaPath, type: 'image' }],
        },
      ],
      integration
    );

    expect(fetchMock.mock.calls[0][0]).toBe(mediaPath);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(fetchMock.mock.calls[1][0]).toBe(mediaPath);
    const [, body, options] = graphPost.mock.calls[0];
    expect(body).toBeInstanceOf(FormDataUpload);
    expect(options.headers['content-type']).toContain('multipart/form-data');
    const streams = (body as any)._streams.join('');
    expect(streams).toContain('name="source"');
    expect(streams).toContain('name="description"');
    expect(streams).toContain('Video post');
    expect(streams).toContain('name="published"');
    expect(streams).toContain('true');
  });
});
