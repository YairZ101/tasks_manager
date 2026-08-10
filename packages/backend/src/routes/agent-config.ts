import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../db/database.js';
import type { AgentConfig } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import { parseAgentSetup } from '../agents/config.js';

const agentConfig = new Hono();

type AgentTestResult = { success: boolean; durationMs: number; error?: string };

async function runAgentTest(config: AgentConfig, onOutput: (line: string) => void): Promise<AgentTestResult> {
  const testPrompt = 'Respond with exactly: OK';
  const startTime = Date.now();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30_000);
  try {
    const result = await new CliAdapter(config).execute({
      task: {
        id: 0,
        task_key: 'TEST-0',
        title: testPrompt,
        description: '',
        acceptance: '',
        preferred_flow_id: null,
        resolution: 'open',
        sort_order: 0,
        created_at: '',
        updated_at: '',
      },
      prompt: testPrompt,
      workingDir: process.cwd(),
      onOutput,
      signal: abortController.signal,
    });
    return { success: result.success, durationMs: Date.now() - startTime, error: result.success ? undefined : result.summary };
  } catch (err: any) {
    return { success: false, durationMs: Date.now() - startTime, error: err.message || 'Unknown error' };
  } finally {
    clearTimeout(timeout);
  }
}

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
    max_concurrent_executions,
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

  if (max_concurrent_executions !== undefined && (
    typeof max_concurrent_executions !== 'number' ||
    !Number.isInteger(max_concurrent_executions) ||
    max_concurrent_executions < 1 ||
    max_concurrent_executions > 10
  )) {
    return c.json({ error: 'max_concurrent_executions must be an integer between 1 and 10' }, 400);
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
  if (max_concurrent_executions !== undefined) {
    updates.push('max_concurrent_executions = ?');
    params.push(max_concurrent_executions);
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

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const stream = body?.stream === true;
  const setupInput = body ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'stream')) : null;
  const setup = setupInput ? parseAgentSetup(setupInput, config) : null;
  if (setup && 'error' in setup) return c.json({ error: setup.error }, 400);
  const candidate = setup?.config ?? config;
  if (!candidate.cli_cmd?.trim()) return c.json({ error: 'Agent CLI command is required.' }, 400);

  if (stream) {
    return streamSSE(c, async (sse) => {
      let outputLength = 0;
      let writes = Promise.resolve();
      const appendOutput = (line: string) => {
        if (outputLength >= 12_000) return;
        const clipped = line.slice(0, 12_000 - outputLength);
        outputLength += clipped.length + 1;
        writes = writes.then(() => sse.writeSSE({ event: 'output', data: JSON.stringify({ line: clipped }) }));
      };
      const result = await runAgentTest(candidate, appendOutput);
      await writes;
      await sse.writeSSE({ event: 'complete', data: JSON.stringify(result) });
    });
  }

  const output: string[] = [];
  let outputLength = 0;
  const appendOutput = (line: string) => {
    if (outputLength >= 12_000) return;
    const remaining = 12_000 - outputLength;
    const clipped = line.slice(0, remaining);
    output.push(clipped);
    outputLength += clipped.length + 1;
  };
  const result = await runAgentTest(candidate, appendOutput);
  return c.json({ ...result, output: output.join('\n') });
});

export default agentConfig;
