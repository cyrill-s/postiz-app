const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const root = __dirname;
const envFile = path.join(root, '.env');
const fileEnv = fs.existsSync(envFile)
  ? dotenv.parse(fs.readFileSync(envFile))
  : {};
const env = { ...fileEnv, ...process.env };

module.exports = {
  apps: [
    {
      name: 'backend',
      cwd: path.join(root, 'apps/backend'),
      script: path.join(root, 'ops/postiz-readiness/backend-launch.cjs'),
      node_args: '--experimental-require-module',
      env,
      kill_timeout: 10000,
    },
    {
      name: 'orchestrator',
      cwd: path.join(root, 'apps/orchestrator'),
      script: path.join(root, 'apps/orchestrator/dist/apps/orchestrator/src/main.js'),
      node_args: '--experimental-require-module',
      env,
      kill_timeout: 10000,
    },
    {
      name: 'frontend',
      cwd: path.join(root, 'apps/frontend'),
      script: path.join(root, 'node_modules/next/dist/bin/next'),
      args: ['start', '-p', '4200'],
      env,
      kill_timeout: 10000,
    },
  ],
};
