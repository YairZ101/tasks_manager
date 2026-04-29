import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import fs from 'fs';
import path from 'path';
import { initDataDir } from './init-data-dir.js';
import { initDb, closeDb, getDb } from './db/database.js';
import { acquireLock, releaseLock } from './lock.js';
import { runCrashRecovery } from './recovery.js';
import { broadcaster } from './sse/broadcaster.js';
import { shutdownAgent } from './executor/executor.js';
import tasksRoutes from './routes/tasks.js';
import logsRoutes from './routes/logs.js';
import agentConfigRoutes from './routes/agent-config.js';
import agentControlRoutes from './routes/agent-control.js';
import initRoutes from './routes/init.js';
import type { ProjectConfig } from './types.js';

const DEFAULT_PORT = 4200;

// Parse args
let portArg: number | undefined;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    portArg = parseInt(args[i + 1], 10);
  }
}

const repoRoot = process.cwd();

// Step 1: Create data directory
initDataDir(repoRoot);

// Step 2: Acquire PID lock
acquireLock(repoRoot);

// Step 3: Connect to DB
initDb(repoRoot);

// Step 4: Crash recovery
runCrashRecovery();

// Step 5: Create Hono app
const app = new Hono();

// Body size limit
app.use('*', bodyLimit({ maxSize: 1024 * 1024 }));

// JSON error handling
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

// API routes
app.get('/status', (c) => {
  const db = getDb();
  const projectConfig = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
  return c.json({
    initialized: !!projectConfig,
    projectConfig: projectConfig || undefined,
    repoName: path.basename(repoRoot),
  });
});

app.get('/events', (c) => {
  const lastEventId = c.req.header('Last-Event-ID');
  return broadcaster.connect(c, lastEventId);
});

app.route('/tasks/:id/agent', agentControlRoutes);
app.route('/tasks/:id/logs', logsRoutes);
app.route('/tasks', tasksRoutes);
app.route('/agent-config', agentConfigRoutes);
app.route('/init', initRoutes);

// Serve frontend static files in production
const frontendDist = path.join(import.meta.dir, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.get('/*', async (c) => {
    const reqPath = c.req.path;
    // Try to serve the exact file
    let filePath = path.resolve(frontendDist, reqPath.replace(/^\/+/, ''));
    if (!filePath.startsWith(frontendDist)) {
      return c.notFound();
    }
    let file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
    // SPA fallback: serve index.html
    filePath = path.join(frontendDist, 'index.html');
    file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return c.notFound();
  });
}

// Step 6: Start server
broadcaster.start();

const port = portArg || DEFAULT_PORT;

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port,
    idleTimeout: 255,
    fetch: app.fetch,
  });
} catch (err) {
  console.error(`\n  ✖ Port ${port} is already in use. Kill the other process or use --port <number>.\n`);
  releaseLock(repoRoot);
  closeDb();
  process.exit(1);
}

console.log(`\n  🚀 Tasks Manager running at http://localhost:${port}\n`);

// Graceful shutdown
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');

  // Step 1: Stop accepting new requests
  server.stop();

  // Step 2: Kill running agent and wait for it to die
  const agentPid = shutdownAgent();
  if (agentPid) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        process.kill(agentPid, 0);
        Bun.sleepSync(100);
      } catch {
        break;
      }
    }
    // Force kill if still alive
    try {
      process.kill(-agentPid, 'SIGKILL');
    } catch {
      try { process.kill(agentPid, 'SIGKILL'); } catch { /* dead */ }
    }
  }

  // Step 3: Stop SSE
  broadcaster.stop();

  // Step 4: Close DB
  closeDb();

  // Step 5: Release lock
  releaseLock(repoRoot);

  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
