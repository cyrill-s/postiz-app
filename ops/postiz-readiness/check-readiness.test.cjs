const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');

const check = path.join(__dirname, 'check-readiness.cjs');
let server;
let address;
let mcpStatus = 401;
let apiStatus = 200;

before(async () => {
  server = http.createServer((request, response) => {
    response.statusCode = request.url === '/auth' ? 200 : request.url === '/api/mcp' ? mcpStatus : apiStatus;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function runCheck() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [check], {
      env: { ...process.env, POSTIZ_HEALTH_BASE_URL: address },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
}

test('ready when frontend and authenticated MCP route respond', async () => {
  mcpStatus = 401;
  assert.equal(await runCheck(), 0);
});

test('unready when frontend is healthy but backend MCP is 502', async () => {
  mcpStatus = 502;
  assert.equal(await runCheck(), 1);
});

test('unready when the MCP route disappears', async () => {
  mcpStatus = 404;
  assert.equal(await runCheck(), 1);
});

test('unready when the API route fails while MCP responds', async () => {
  mcpStatus = 401;
  apiStatus = 502;
  assert.equal(await runCheck(), 1);
});
