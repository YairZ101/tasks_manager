import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import type { AgentConfig } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';

const agentConfig = new Hono();

// GET /agent-config
agentConfig.get('/', (c) => {
  const db = getDb();
  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
  return c.json({ config });
});

// PUT /agent-config
agentConfig.put('/', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const {
    cli_cmd,
    cli_prompt_mode,
    cli_prompt_flag,
    timeout_ms,
  } = body;

  // Validate cli_cmd
  if (cli_cmd !== undefined && cli_cmd !== null && typeof cli_cmd !== 'string') {
    return c.json({ error: 'cli_cmd must be a string' }, 400);
  }

  // Validate cli_prompt_mode
  if (cli_prompt_mode !== undefined && !['stdin', 'argument', 'flag'].includes(cli_prompt_mode)) {
    return c.json({ error: 'Invalid cli_prompt_mode' }, 400);
  }

  // Validate cli_prompt_flag
  if (cli_prompt_flag !== undefined && cli_prompt_flag !== null && typeof cli_prompt_flag !== 'string') {
    return c.json({ error: 'cli_prompt_flag must be a string' }, 400);
  }

  // Validate timeout_ms
  if (timeout_ms !== undefined && (typeof timeout_ms !== 'number' || timeout_ms < 1000)) {
    return c.json({ error: 'Timeout must be at least 1000ms' }, 400);
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (cli_cmd !== undefined) {
    updates.push('cli_cmd = ?');
    params.push(cli_cmd);
  }
  if (cli_prompt_mode !== undefined) {
    updates.push('cli_prompt_mode = ?');
    params.push(cli_prompt_mode);
  }
  if (cli_prompt_flag !== undefined) {
    updates.push('cli_prompt_flag = ?');
    params.push(cli_prompt_flag);
  }
  if (timeout_ms !== undefined) {
    updates.push('timeout_ms = ?');
    params.push(timeout_ms);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    db.query(`UPDATE agent_config SET ${updates.join(', ')} WHERE id = 1`).run(...params);
  }

  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
  return c.json({ config });
});

// POST /agent-config/test
agentConfig.post('/test', async (c) => {
  const db = getDb();
  const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();

  if (!config) {
    return c.json({ error: 'Agent not configured' }, 400);
  }

  const testPrompt = 'Respond with exactly: OK';
  const startTime = Date.now();

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 30_000);

    const dummyTask: any = {
      id: 0,
      task_key: 'TEST-0',
      title: testPrompt,
      description: '',
      acceptance: '',
      status: 'todo',
      agent_status: null,
    };

    const adapter = new CliAdapter(config);

    await adapter.execute({
      task: dummyTask,
      prompt: testPrompt,
      workingDir: process.cwd(),
      onOutput: () => {},
      signal: abortController.signal,
    });

    clearTimeout(timeout);

    return c.json({
      success: true,
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    return c.json({
      success: false,
      durationMs: Date.now() - startTime,
      error: err.message || 'Unknown error',
    });
  }
});

export default agentConfig;
