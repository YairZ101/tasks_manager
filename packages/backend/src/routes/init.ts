import { Hono } from 'hono';
import path from 'path';
import { getDb } from '../db/database.js';
import type { AgentConfig, ProjectConfig } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import { ApiAdapter } from '../agents/api-adapter.js';

const init = new Hono();

// POST /init/generate-prefix
init.post('/generate-prefix', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);

  if (!body || !body.repoName || typeof body.repoName !== 'string') {
    return c.json({ error: 'repoName is required' }, 400);
  }

  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
  if (!config) {
    return c.json({ error: 'Agent not configured' }, 400);
  }

  const prompt = `Generate a JIRA-style project key for '${body.repoName}'. 2-5 uppercase letters, memorable, related to the name. Examples: 'photo-editor' → SNAP, 'chat-service' → CHAT, 'data-pipeline' → PIPE. Reply with ONLY the key.`;

  const adapter = config.type === 'cli' ? new CliAdapter(config) : new ApiAdapter(config);

  let lastOutput = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 30_000);

      lastOutput = '';

      await adapter.execute({
        task: {
          id: 0,
          task_key: 'INIT-0',
          title: prompt,
          description: '',
          acceptance: '',
          status: 'todo',
          agent_status: null,
          agent_pid: null,
          agent_started_at: null,
          sort_order: 0,
          created_at: '',
          updated_at: '',
        },
        prompt,
        workingDir: process.cwd(),
        onOutput: (line: string) => {
          lastOutput += line + '\n';
        },
        signal: abortController.signal,
      });

      clearTimeout(timeout);

      // Parse the output leniently
      const match = lastOutput.match(/[A-Za-z0-9]+/);
      if (match) {
        const prefix = match[0].toUpperCase().substring(0, 5);
        if (/^[A-Z0-9]{1,5}$/.test(prefix)) {
          return c.json({ prefix });
        }
      }
    } catch (err: any) {
      if (attempt === 2) {
        return c.json(
          { error: `Failed to generate prefix after 3 attempts: ${err.message}` },
          500
        );
      }
    }
  }

  return c.json({ error: 'Failed to generate a valid prefix. Please enter one manually.' }, 500);
});

// POST /init/save-prefix
init.post('/save-prefix', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);

  if (!body || !body.prefix || typeof body.prefix !== 'string') {
    return c.json({ error: 'prefix is required' }, 400);
  }

  const prefix = body.prefix.toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(prefix)) {
    return c.json({ error: 'Prefix must be 1-5 uppercase alphanumeric characters' }, 400);
  }

  const repoName = body.repoName || path.basename(process.cwd());

  // Check if already initialized
  const existing = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
  if (existing) {
    return c.json({ error: 'Project already initialized' }, 400);
  }

  db.query(
    `INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, ?, ?)`
  ).run(prefix, repoName);

  const projectConfig = db
    .query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1')
    .get();

  return c.json({ projectConfig });
});

export default init;
