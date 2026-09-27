const http = require('node:http');

const baseUrl = process.env.POSTIZ_HEALTH_BASE_URL || 'http://127.0.0.1:5000';

function status(path) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}${path}`, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.setTimeout(4000, () => request.destroy(new Error('timeout')));
  });
}

async function main() {
  // The monitor route exercises the API; MCP returns 401 only once its route is live.
  const [frontend, api, mcp] = await Promise.all([
    status('/auth'),
    status('/api/monitor/health'),
    status('/api/mcp'),
  ]);
  if (frontend !== 200 || api !== 200 || mcp !== 401) {
    throw new Error(`frontend=${frontend} api=${api} mcp=${mcp}`);
  }
}

main().catch((error) => {
  console.error(`Postiz readiness failed: ${error.message}`);
  process.exitCode = 1;
});
