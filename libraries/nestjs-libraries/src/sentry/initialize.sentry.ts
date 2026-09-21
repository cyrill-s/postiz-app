import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';

// These requests carry login capabilities or client credentials. Exclude both
// errors and traces instead of retaining request bodies or ticket query strings.
const omitCredentialRequests = <
  T extends { request?: { url?: string }; transaction?: string }
>(
  event: T
): T | null => {
  const location = `${event.request?.url || ''} ${event.transaction || ''}`;
  return /\/internal\/juls(?:\/|[ ?]|$)|\/oauth\/token(?:[ ?]|$)/.test(location)
    ? null
    : event;
};

export const initializeSentry = (appName: string, allowLogs = false) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `Postiz ${capitalize(appName)}`,
          },
        },
      },
      environment: process.env.NODE_ENV || 'development',
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
        Sentry.consoleLoggingIntegration({
          levels: ['log', 'info', 'warn', 'error', 'debug', 'assert', 'trace'],
        }),
        Sentry.openAIIntegration({
          recordInputs: true,
          recordOutputs: true,
        }),
      ],
      beforeSend: omitCredentialRequests,
      beforeSendTransaction: omitCredentialRequests,
      tracesSampleRate: 1.0,
      enableLogs: true,

      // Profiling
      profileSessionSampleRate:
        process.env.NODE_ENV === 'development' ? 1.0 : 0.45,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
