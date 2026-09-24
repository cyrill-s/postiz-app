const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postiz-backend-launch-'));
  fs.writeFileSync(path.join(dir, 'stall.cjs'), 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(path.join(dir, 'ready.cjs'), 'globalThis.postizBackendStartupComplete();\n');
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function launch(entry) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'backend-launch.cjs')], {
      env: {
        ...process.env,
        POSTIZ_BACKEND_ENTRY: path.join(dir, entry),
        POSTIZ_BACKEND_STARTUP_TIMEOUT_MS: '100',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => output += chunk);
    child.stderr.on('data', (chunk) => output += chunk);
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
  });
}

test('exits when a module loads without opening the backend', async () => {
  const result = await launch('stall.cjs');
  assert.equal(result.code, 1);
  assert.match(result.output, /Backend did not listen/);
});

test('clears the deadline after backend listen', async () => {
  const result = await launch('ready.cjs');
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.output, /Backend did not listen/);
});
