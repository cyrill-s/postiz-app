import { temporalQueues } from './temporal.queues';
import { TemporalModule } from 'nestjs-temporal-core';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { emailQueues } from '@gitroom/nestjs-libraries/temporal/email.queues';

export const getTemporalModule = (
  isWorkers: boolean,
  path?: string,
  activityClasses?: any[]
) => {
  // Queues this worker server should NOT run, comma-separated
  // (e.g. EXCLUDE_QUEUE="reddit,x,twitch"). Use it to pin a queue to a single
  // server: exclude it on every server except the one that should own it.
  // Meant for the providers whose concurrency is too low to split (limit 1).
  const excludeQueues = (process.env.EXCLUDE_QUEUE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // How many worker servers share each (non-excluded) queue. Per-server
  // concurrency is divided by this so the GLOBAL concurrency stays correct.
  // 1 server => 1 (full), 2 servers => 2 (half each), 3 servers => 3, etc.
  const divider = Math.max(
    1,
    Number(process.env.WORKER_CONCURRENCY_DIVIDER) || 1
  );

  return TemporalModule.register({
    isGlobal: true,
    connection: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
      ...(process.env.TEMPORAL_API_KEY
        ? { apiKey: process.env.TEMPORAL_API_KEY }
        : {}),
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    },
    taskQueue: 'main',
    logLevel: 'error',
    ...(isWorkers
      ? {
          workers: [
            ...temporalQueues([
              { identifier: 'main', maxConcurrentJob: undefined },
              ...socialIntegrationList,
            ])
              .filter(({ identifier }) => !excludeQueues.includes(identifier))
              .map((integration) => {
                const taskQueue = integration.identifier;
                // Split the per-provider cap across the servers sharing this queue.
                const concurrency = integration.maxConcurrentJob
                  ? Math.max(
                      1,
                      Math.floor(integration.maxConcurrentJob / divider)
                    )
                  : undefined;

                return {
                  taskQueue,
                  // Only main runs workflows; provider workers are activity-only.
                  ...(taskQueue !== 'main'
                    ? {}
                    : process.env.TEMPORAL_WORKFLOW_BUNDLE
                    ? {
                        workflowBundle: {
                          codePath: process.env.TEMPORAL_WORKFLOW_BUNDLE,
                        },
                      }
                    : { workflowsPath: path! }),
                  activityClasses: activityClasses!,
                  autoStart: true,
                  workerOptions: {
                    maxConcurrentActivityTaskExecutions:
                      process.env.TEMPORAL_LOW_MEMORY === 'true'
                        ? Math.min(concurrency || 4, 4)
                        : concurrency || 1000000,
                    ...(process.env.TEMPORAL_LOW_MEMORY === 'true'
                      ? {
                          maxCachedWorkflows: 10,
                          maxConcurrentWorkflowTaskExecutions: 2,
                          workflowThreadPoolSize: 1,
                          reuseV8Context: true,
                        }
                      : {}),
                    maxHeartbeatThrottleInterval: '15s',
                  },
                };
              }),
            // Email activity queues keep upstream's server-side rate limits.
            ...Object.values(emailQueues)
              .filter(({ taskQueue }) => !excludeQueues.includes(taskQueue))
              .map(({ taskQueue, perSecond }) => ({
                taskQueue,
                activityClasses: activityClasses!,
                autoStart: true,
                workerOptions: {
                  maxConcurrentActivityTaskExecutions:
                    process.env.TEMPORAL_LOW_MEMORY === 'true' ? 4 : 10,
                  maxTaskQueueActivitiesPerSecond: perSecond,
                },
              })),
          ],
        }
      : {}),
  });
};
