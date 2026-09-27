// Safe operational replacement for `pm2 restart backend` in the app container.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');

const backendScript = process.env.POSTIZ_BACKEND_SCRIPT_PATH ||
  '/app/ops/postiz-readiness/backend-launch.cjs';
const readiness = '/app/ops/postiz-readiness/check-readiness.cjs';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, timeout = 15_000) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function backendProcesses() {
  return fs.readdirSync('/proc').filter((pid) => /^\d+$/.test(pid)).filter((pid) => {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(backendScript);
    } catch {
      return false;
    }
  });
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.connect(3000, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(true); });
  });
}

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) return true;
    await wait(1000);
  } while (Date.now() < deadline);
  return false;
}

async function main() {
  run('pm2', ['stop', 'backend']);
  const stopped = await until(async () => backendProcesses().length === 0 && !(await portOpen()), 15_000);
  if (!stopped) {
    throw new Error('Backend process or port 3000 survived PM2 stop; inspect before starting another listener');
  }
  run('pm2', ['restart', 'backend']);
  const listening = await until(async () =>
    backendProcesses().length === 1 && await portOpen(), 270_000);
  if (!listening) throw new Error('Backend did not open one listener within 270 seconds');

  // Nginx workers can retain a failed upstream for ten seconds after the port
  // returns. Wait past that window, then require several successful probes.
  await wait(12_000);
  let successful = 0;
  const ready = await until(() => {
    const probe = spawnSync(process.execPath, [readiness], {
      stdio: 'ignore', timeout: 10_000,
    }).status === 0;
    successful = probe && backendProcesses().length === 1 ? successful + 1 : 0;
    return successful >= 3;
  }, 45_000);
  if (!ready) throw new Error('Backend readiness did not recover within five minutes');
  console.log('Backend restarted with one verified listener');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
