// Run only in a disposable Postiz container with this branch's ecosystem and check mounted.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const dir = '/tmp/postiz-readiness-smoke';
fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(`${dir}/backend.cjs`,
  "require('node:http').createServer((req,res)=>{res.statusCode=req.url.startsWith('/monitor/')?200:401;res.end()}).listen(3000,'127.0.0.1');\n"
);
fs.writeFileSync(`${dir}/frontend.cjs`,
  "require('node:http').createServer((req,res)=>{res.statusCode=200;res.end()}).listen(4200,'127.0.0.1');\n"
);
fs.writeFileSync(`${dir}/orchestrator.cjs`, 'setInterval(() => {}, 1000);\n');

const config = require('/app/ecosystem.config.cjs');
process.env.POSTIZ_BACKEND_SCRIPT_PATH = `${dir}/backend.cjs`;
for (const app of config.apps) {
  app.script = `${dir}/${app.name}.cjs`;
  app.args = [];
}
fs.writeFileSync(`${dir}/ecosystem.config.cjs`, `module.exports = ${JSON.stringify(config)};\n`);

function run(command, args, capture = false, timeout = 15_000) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    timeout,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.status}`);
  }
  return result.stdout;
}
const health = () => spawnSync(process.execPath, ['/app/ops/postiz-readiness/check-readiness.cjs'], { timeout: 10_000 }).status;
const processes = () => JSON.parse(run('pm2', ['jlist'], true));
const backend = () => processes().find((entry) => entry.name === 'backend');
const alive = (pid) => fs.existsSync(`/proc/${pid}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, message) {
  for (let i = 0; i < 50; i++) {
    if (await predicate()) return;
    await wait(200);
  }
  throw new Error(message);
}

function directBackendCount() {
  return fs.readdirSync('/proc').filter((pid) => /^\d+$/.test(pid)).filter((pid) => {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(`${dir}/backend.cjs`);
    } catch {
      return false;
    }
  }).length;
}

async function main() {
  run('nginx', []);
  try {
    run('pm2', ['start', `${dir}/ecosystem.config.cjs`]);
    await until(() => health() === 0, 'frontend and MCP never became ready');
    assert.equal(directBackendCount(), 1);
    let oldPid = backend().pid;
    assert.match(fs.readFileSync(`/proc/${oldPid}/cmdline`, 'utf8'), /backend\.cjs/);

    run('pm2', ['stop', 'backend']);
    await until(() => health() === 1, 'readiness stayed green without backend');
    assert.equal(alive(oldPid), false, 'backend survived PM2 stop');
    assert.equal(directBackendCount(), 0);
    run('pm2', ['restart', 'backend']);
    await until(() => health() === 0, 'backend did not recover after stop');
    assert.equal(directBackendCount(), 1);
    for (let i = 0; i < 3; i++) {
      oldPid = backend().pid;
      run('node', ['/app/ops/postiz-readiness/restart-backend.cjs'], false, 75_000);
      assert.equal(alive(oldPid), false, 'old backend survived controlled restart');
      const verdict = spawnSync(process.execPath, ['/app/ops/postiz-readiness/check-readiness.cjs'], { encoding: 'utf8', timeout: 10_000 });
      if (verdict.status !== 0) {
        console.error('iteration', i, 'readiness', verdict.status, verdict.stderr?.trim(), 'pm2', processes().map((entry) => ({ name: entry.name, pid: entry.pid, status: entry.pm2_env.status, restarts: entry.pm2_env.restart_time })), 'backend processes', directBackendCount());
      }
      assert.equal(verdict.status, 0, 'restart did not restore MCP');
      assert.equal(directBackendCount(), 1, 'duplicate after restart from stopped');
    }
    console.log('isolated PM2/Nginx readiness, stop/start, and recovery: PASS');
  } finally {
    spawnSync('pm2', ['kill'], { timeout: 10_000 });
    spawnSync('nginx', ['-s', 'stop'], { timeout: 10_000 });
  }
}

main().catch((error) => {
  console.error(error.message);
  const result = spawnSync(process.execPath, ['/app/ops/postiz-readiness/check-readiness.cjs'], { encoding: 'utf8', timeout: 10_000 });
  console.error('readiness', result.status, result.stderr?.trim());
  try {
    console.error('pm2', processes().map((entry) => ({ name: entry.name, pid: entry.pid, status: entry.pm2_env.status, restarts: entry.pm2_env.restart_time })));
  } catch {}
  console.error('backend processes', directBackendCount());
  process.exitCode = 1;
});
