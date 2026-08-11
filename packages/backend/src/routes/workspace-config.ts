import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { sanitizeLine } from '../agents/cli-adapter.js';
import { runWorkspaceCommand } from '../flow/workspace-command.js';
import { parseWorkspaceConfig, suggestWorkspaceSetupCommand, type WorkspaceConfigInput } from '../flow/workspace-config.js';
import { isGitRepo } from '../worktree/worktree.js';
import type { WorkspaceConfig } from '../types.js';

const execFileAsync = promisify(execFile);

export default function workspaceConfigRoutes(repoRoot: string) {
  const routes = new Hono();

  routes.get('/', (c) => {
    const config = getDb().query<WorkspaceConfig, []>('SELECT * FROM workspace_config WHERE id = 1').get()!;
    return c.json({ config, suggestedCommand: suggestWorkspaceSetupCommand(repoRoot) });
  });

  routes.put('/', async (c) => {
    const db = getDb();
    const current = db.query<WorkspaceConfig, []>('SELECT * FROM workspace_config WHERE id = 1').get()!;
    const parsed = parseWorkspaceConfig(await c.req.json().catch(() => ({})) as WorkspaceConfigInput, current);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    db.query('UPDATE workspace_config SET setup_command = ?, timeout_ms = ? WHERE id = 1')
      .run(parsed.config.setup_command, parsed.config.timeout_ms);
    return c.json({ config: db.query<WorkspaceConfig, []>('SELECT * FROM workspace_config WHERE id = 1').get()! });
  });

  routes.post('/test', async (c) => {
    if (!isGitRepo(repoRoot)) return c.json({ error: 'Testing workspace setup requires a Git repository.' }, 409);
    const db = getDb();
    const current = db.query<WorkspaceConfig, []>('SELECT * FROM workspace_config WHERE id = 1').get()!;
    const parsed = parseWorkspaceConfig(await c.req.json().catch(() => ({})) as WorkspaceConfigInput, current);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    if (!parsed.config.setup_command) return c.json({ error: 'Add a workspace setup command before testing it.' }, 400);

    const setupTestsRoot = path.join(repoRoot, '.flow', 'setup-tests');
    fs.mkdirSync(setupTestsRoot, { recursive: true });
    const worktreePath = path.join(setupTestsRoot, `test-${crypto.randomUUID()}`);
    const output: string[] = [];
    try {
      await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], { cwd: repoRoot });
      const result = await runWorkspaceCommand({
        command: parsed.config.setup_command,
        cwd: worktreePath,
        timeoutMs: parsed.config.timeout_ms,
        onOutput: (level, line) => {
          if (output.length < 1000) output.push(`${level === 'error' ? 'ERR' : 'OUT'}  ${sanitizeLine(line)}`);
        },
      });
      const success = result.exitCode === 0 && !result.timedOut;
      return c.json({
        success,
        durationMs: result.durationMs,
        output: output.join('\n'),
        error: success ? undefined : result.timedOut ? 'Workspace setup timed out.' : `Workspace setup exited with code ${result.exitCode ?? 'unknown'}.`,
      });
    } finally {
      await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoRoot }).catch(() => {});
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  return routes;
}
