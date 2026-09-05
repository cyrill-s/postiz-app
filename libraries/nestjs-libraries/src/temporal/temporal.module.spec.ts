jest.mock('nestjs-temporal-core', () => ({ TemporalModule: { register: (options: unknown) => options } }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ socialIntegrationList: [
  { identifier: 'vk', maxConcurrentJob: 2 }, { identifier: 'vk-community', maxConcurrentJob: 1 },
  { identifier: 'ok-community', maxConcurrentJob: 1 }, { identifier: 'telegram', maxConcurrentJob: 10 },
] }));
import { getTemporalModule } from './temporal.module';
describe('Temporal provider queue routing', () => {
  const original = { ...process.env };
  beforeEach(() => { delete process.env.EXCLUDE_QUEUE; delete process.env.TEMPORAL_WORKFLOW_BUNDLE; delete process.env.TEMPORAL_LOW_MEMORY; delete process.env.WORKER_CONCURRENCY_DIVIDER; });
  afterAll(() => { process.env = original; });
  it('registers root queues for standalone variants and deduplicates aliases', () => {
    const config = getTemporalModule(true, '/workflows', []) as any;
    expect(config.workers.map((w: any) => w.taskQueue)).toEqual(['main','vk','ok','telegram']);
    expect(config.workers.find((w: any) => w.taskQueue === 'vk').workerOptions.maxConcurrentActivityTaskExecutions).toBe(1);
  });
  it('preserves queue exclusions and activity concurrency division', () => {
    process.env.EXCLUDE_QUEUE = 'vk'; process.env.WORKER_CONCURRENCY_DIVIDER = '2';
    const config = getTemporalModule(true, '/workflows', []) as any;
    expect(config.workers.map((w: any) => w.taskQueue)).toEqual(['main','ok','telegram']);
    expect(config.workers.find((w: any) => w.taskQueue === 'telegram').workerOptions.maxConcurrentActivityTaskExecutions).toBe(5);
  });
  it('uses a prebuilt bundle without runtime compilation and bounds memory/concurrency', () => {
    process.env.TEMPORAL_WORKFLOW_BUNDLE = '/bundle.js'; process.env.TEMPORAL_LOW_MEMORY = 'true';
    const config = getTemporalModule(true, '/workflows', []) as any;
    for(const worker of config.workers) {
      expect(worker.workflowsPath).toBeUndefined();
      expect(worker.workflowBundle).toEqual({ codePath: '/bundle.js' });
      expect(worker.workerOptions).toMatchObject({ maxCachedWorkflows: 10, maxConcurrentWorkflowTaskExecutions: 2, workflowThreadPoolSize: 1, reuseV8Context: true });
      expect(worker.workerOptions.maxConcurrentActivityTaskExecutions).toBeLessThanOrEqual(4);
    }
  });
  it('does not register workers in backend processes', () => {
    expect((getTemporalModule(false) as any).workers).toBeUndefined();
  });
});
