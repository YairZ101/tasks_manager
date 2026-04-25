import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import type { AgentConfig } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import { ApiAdapter } from '../agents/api-adapter.js';

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
    type,
    cli_cmd,
    cli_prompt_mode,
    cli_prompt_flag,
    api_url,
    api_headers,
    api_model,
    api_request_format,
    api_stream_format,
    timeout_ms,
  } = body;

  // Validate type
  if (type && !['cli', 'api'].includes(type)) {
    return c.json({ error: 'Type must be "cli" or "api"' }, 400);
  }

  // Validate cli_prompt_mode
  if (cli_prompt_mode && !['stdin', 'argument', 'flag'].includes(cli_prompt_mode)) {
    return c.json({ error: 'Invalid cli_prompt_mode' }, 400);
  }

  // Validate api_request_format
  if (api_request_format && !['openai', 'ollama'].includes(api_request_format)) {
    return c.json({ error: 'Invalid api_request_format' }, 400);
  }

  // Validate api_stream_format
  if (api_stream_format && !['sse', 'ndjson', 'none'].includes(api_stream_format)) {
    return c.json({ error: 'Invalid api_stream_format' }, 400);
  }

  // Validate api_headers
  if (api_headers !== undefined && api_headers !== null) {
    if (typeof api_headers === 'string') {
      if (api_headers.length > 10240) {
        return c.json({ error: 'API headers must be at most 10KB' }, 400);
      }
      try {
        const parsed = JSON.parse(api_headers);
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          return c.json({ error: 'API headers must be a JSON object' }, 400);
        }
        for (const [, v] of Object.entries(parsed)) {
          if (typeof v !== 'string') {
            return c.json({ error: 'API header values must be strings' }, 400);
          }
        }
      } catch {
        return c.json({ error: 'API headers must be valid JSON' }, 400);
      }
    } else if (typeof api_headers === 'object') {
      // Accept object directly, serialize to JSON
      const serialized = JSON.stringify(api_headers);
      if (serialized.length > 10240) {
        return c.json({ error: 'API headers must be at most 10KB' }, 400);
      }
    }
  }

  // Validate timeout_ms
  if (timeout_ms !== undefined && (typeof timeout_ms !== 'number' || timeout_ms < 1000)) {
    return c.json({ error: 'Timeout must be at least 1000ms' }, 400);
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (type !== undefined) {
    updates.push('type = ?');
    params.push(type);
  }
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
  if (api_url !== undefined) {
    updates.push('api_url = ?');
    params.push(api_url);
  }
  if (api_headers !== undefined) {
    updates.push('api_headers = ?');
    const value =
      typeof api_headers === 'object' && api_headers !== null
        ? JSON.stringify(api_headers)
        : api_headers;
    params.push(value);
  }
  if (api_model !== undefined) {
    updates.push('api_model = ?');
    params.push(api_model);
  }
  if (api_request_format !== undefined) {
    updates.push('api_request_format = ?');
    params.push(api_request_format);
  }
  if (api_stream_format !== undefined) {
    updates.push('api_stream_format = ?');
    params.push(api_stream_format);
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
      _prompt: testPrompt,
    };

    const adapter =
      config.type === 'cli' ? new CliAdapter(config) : new ApiAdapter(config);

    await adapter.execute({
      task: dummyTask,
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
