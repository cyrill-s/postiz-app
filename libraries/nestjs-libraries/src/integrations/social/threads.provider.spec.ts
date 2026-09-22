import { ThreadsProvider } from './threads.provider';

describe('Threads OAuth', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.THREADS_APP_ID = 'threads-app-id';
    process.env.FRONTEND_URL = 'https://postiz.example.com';
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  it('uses the current Threads authorization endpoint and authorization-code flow', async () => {
    const provider = new ThreadsProvider();
    const { url } = await provider.generateAuthUrl();
    const authorization = new URL(url);

    expect(authorization.origin).toBe('https://www.threads.com');
    expect(authorization.pathname).toBe('/oauth/authorize');
    expect(authorization.searchParams.get('client_id')).toBe('threads-app-id');
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'https://postiz.example.com/integrations/social/threads'
    );
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('scope')).toBe(
      provider.scopes.join(',')
    );
  });
});
