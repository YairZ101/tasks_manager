import fs from 'fs';
import path from 'path';
import { initDataDir } from './init-data-dir.js';
import { closeDb, initDb } from './db/database.js';
import { acquireLock, releaseLock } from './lock.js';
import { runCrashRecovery } from './recovery.js';
import { broadcaster } from './sse/broadcaster.js';
import { initEngine, shutdownEngine } from './flow/engine.js';
import { createApp } from './app.js';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number.parseInt(args[portIndex + 1], 10) : 4200;
const repoRoot = process.cwd();

initDataDir(repoRoot);
acquireLock(repoRoot);
initDb(repoRoot);
runCrashRecovery();
initEngine(repoRoot);

const app = createApp(repoRoot);
const frontendDist = path.join(import.meta.dir, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.get('/*', async (c) => {
    const candidate = path.resolve(frontendDist, c.req.path.replace(/^\/+/, ''));
    if (!candidate.startsWith(frontendDist)) return c.notFound();
    let file = Bun.file(candidate);
    if (await file.exists()) return new Response(file);
    file = Bun.file(path.join(frontendDist, 'index.html'));
    return await file.exists() ? new Response(file, { headers: { 'Content-Type': 'text/html' } }) : c.notFound();
  });
}

broadcaster.start();
let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({ port, idleTimeout: 255, fetch: app.fetch });
} catch {
  releaseLock(repoRoot);
  closeDb();
  throw new Error(`Port ${port} is already in use.`);
}
console.log(`\n  Outcome Flow running at http://localhost:${port}\n`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  server.stop();
  await shutdownEngine();
  broadcaster.stop();
  closeDb();
  releaseLock(repoRoot);
  process.exit(0);
};
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
