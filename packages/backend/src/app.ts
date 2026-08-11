import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import path from 'path';
import { getDb } from './db/database.js';
import { broadcaster } from './sse/broadcaster.js';
import { getRunnerState } from './flow/engine.js';
import { isGitRepo } from './worktree/worktree.js';
import tasksRoutes from './routes/tasks.js';
import flowsRoutes from './routes/flows.js';
import runsRoutes from './routes/runs.js';
import attemptsRoutes from './routes/attempts.js';
import workspacesRoutes from './routes/workspaces.js';
import agentConfigRoutes from './routes/agent-config.js';
import agentPresetRoutes from './routes/agent-presets.js';
import workspaceConfigRoutes from './routes/workspace-config.js';
import initRoutes from './routes/init.js';
import type { ProjectConfig } from './types.js';

export function createApp(repoRoot = process.cwd()): Hono {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 1024 * 1024 }));
  app.onError((error: Error & { status?: number; reason?: string; problems?: unknown }, c) => {
    console.error('Server error:', error);
    return c.json({ error: error.message || 'Internal server error', reason: error.reason, problems: error.problems }, (error.status ?? 500) as 400);
  });
  app.get('/status', (c) => {
    const db = getDb();
    const projectConfig = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
    const published = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM flows WHERE is_default = 1 AND active_version_id IS NOT NULL').get()?.count ?? 0;
    return c.json({
      initialized: Boolean(projectConfig) && published === 1,
      projectConfig: projectConfig ?? undefined,
      repoName: path.basename(repoRoot),
      runner: getRunnerState(),
      isGitRepo: isGitRepo(repoRoot),
    });
  });
  app.get('/events', (c) => broadcaster.connect(c, c.req.header('Last-Event-ID')));
  app.route('/tasks', tasksRoutes);
  app.route('/flows', flowsRoutes);
  app.route('/runs', runsRoutes);
  app.route('/attempts', attemptsRoutes);
  app.route('/workspaces', workspacesRoutes);
  app.route('/agent-config', agentConfigRoutes);
  app.route('/agent-presets', agentPresetRoutes);
  app.route('/workspace-config', workspaceConfigRoutes(repoRoot));
  app.route('/init', initRoutes);
  return app;
}
