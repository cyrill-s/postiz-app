// PM2 supervises this process directly. Arm the deadline before loading Nest.
const entry = process.env.POSTIZ_BACKEND_ENTRY ||
  '/app/apps/backend/dist/apps/backend/src/main.js';
const deadlineMs = Number(process.env.POSTIZ_BACKEND_STARTUP_TIMEOUT_MS || 240_000);

if (!Number.isFinite(deadlineMs) || deadlineMs < 1) {
  throw new Error('Invalid backend startup deadline');
}

const deadline = setTimeout(() => {
  console.error(`Backend did not listen within ${deadlineMs} ms`);
  process.exit(1);
}, deadlineMs);
globalThis.postizBackendStartupComplete = () => clearTimeout(deadline);

console.log('Backend module load starting');
require(entry);
console.log('Backend module load completed');
