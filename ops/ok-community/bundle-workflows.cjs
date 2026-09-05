// Run after build:orchestrator, using the same @temporalio/worker version as the
// pinned production image. No network or application credentials are needed.
const { bundleWorkflowCode } = require('@temporalio/worker');
const { writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');
(async () => {
  const root = resolve(__dirname, '../..');
  const bundle = await bundleWorkflowCode({ workflowsPath: require.resolve(resolve(root, 'apps/orchestrator/dist/apps/orchestrator/src/workflows')) });
  mkdirSync(resolve(root, '.local-build'), { recursive: true });
  writeFileSync(resolve(root, '.local-build/workflow-bundle.js'), bundle.code);
  console.log('Workflow bundle ready; SDK ' + require('@temporalio/worker/package.json').version);
})().catch(() => { console.error('Workflow bundle failed'); process.exitCode = 1; });
