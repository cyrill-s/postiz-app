import * as Sentry from '@sentry/nestjs';
import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  consoleLoggingIntegration: jest.fn(),
  openAIIntegration: jest.fn(),
}));
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn(),
}));

test('credential routes are excluded from Sentry errors and traces', () => {
  const previous = process.env.NEXT_PUBLIC_SENTRY_DSN;
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://synthetic@example.test/1';
  try {
    initializeSentry('backend');
    const options = (Sentry.init as jest.Mock).mock.calls[0][0];
    for (const hook of [options.beforeSend, options.beforeSendTransaction]) {
      expect(
        hook({
          request: {
            url: 'https://postiz.test/api/internal/juls/session?ticket=secret',
          },
        })
      ).toBeNull();
      expect(
        hook({
          request: {
            url: 'https://postiz.test/api/oauth/token',
            data: { client_secret: 'secret' },
          },
        })
      ).toBeNull();
      expect(hook({ transaction: 'POST /internal/juls/provision' })).toBeNull();
      const safe = { request: { url: 'https://postiz.test/api/integrations' } };
      expect(hook(safe)).toBe(safe);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = previous;
  }
});
