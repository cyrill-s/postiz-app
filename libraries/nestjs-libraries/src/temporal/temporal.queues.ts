// Workflow routing uses the prefix before '-'. A provider with no base variant
// (e.g. ok-community) still needs a worker; aliases must not spawn duplicates.
export function temporalQueues(
  providers: Array<{ identifier: string; maxConcurrentJob?: number }>
) {
  const queues = new Map<
    string,
    { identifier: string; maxConcurrentJob?: number }
  >();
  for (const provider of providers) {
    const identifier = provider.identifier.split('-')[0];
    const existing = queues.get(identifier);
    const caps = [existing?.maxConcurrentJob, provider.maxConcurrentJob].filter(
      (value): value is number => typeof value === 'number' && value > 0
    );
    queues.set(identifier, {
      identifier,
      maxConcurrentJob: caps.length ? Math.min(...caps) : undefined,
    });
  }
  return [...queues.values()];
}
