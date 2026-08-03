import { Hono } from 'hono';
import path from 'path';
import { getDb } from '../db/database.js';
import type { AgentConfig, ProjectConfig } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import { compileFlow, createBlankFlow, createMinimalFlow, createRecommendedFlow } from '@flow/core';
import { parseAgentSetup } from '../agents/config.js';

const init = new Hono();

type FlowTemplate = 'recommended' | 'minimal' | 'blank';

function getTemplate(template: FlowTemplate) {
  switch (template) {
    case 'recommended': return { name: 'Standard delivery', definition: createRecommendedFlow() };
    case 'minimal': return { name: 'Minimal delivery', definition: createMinimalFlow() };
    case 'blank': return { name: 'Blank Flow', definition: createBlankFlow() };
  }
}

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

  const adapter = new CliAdapter(config);

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
          resolution: 'open',
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

  const definition = createRecommendedFlow();
  const compiled = compileFlow(definition);
  db.transaction(() => {
    db.query(`INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, ?, ?)`).run(prefix, repoName);
    const flow = db.query("INSERT INTO flows (name, is_default) VALUES ('Standard delivery', 1)").run();
    const flowId = Number(flow.lastInsertRowid);
    const version = db.query(`INSERT INTO flow_versions
      (flow_id, version, state, definition_json, compiled_json, published_at)
      VALUES (?, 1, 'published', ?, ?, datetime('now'))`).run(flowId, JSON.stringify(definition), JSON.stringify(compiled));
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(Number(version.lastInsertRowid), flowId);
  })();

  const projectConfig = db
    .query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1')
    .get();

  return c.json({ projectConfig });
});

// POST /init/complete
init.post('/complete', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null) as {
    prefix?: string;
    repoName?: string;
    flowTemplate?: FlowTemplate;
    agent?: unknown;
  } | null;
  if (!body || typeof body.prefix !== 'string') return c.json({ error: 'prefix is required' }, 400);

  const prefix = body.prefix.toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(prefix)) return c.json({ error: 'Prefix must be 1-5 uppercase alphanumeric characters' }, 400);
  if (!['recommended', 'minimal', 'blank'].includes(body.flowTemplate ?? '')) return c.json({ error: 'Choose a starting Flow template.' }, 400);

  const currentAgent = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
  if (!currentAgent) return c.json({ error: 'Agent configuration is unavailable.' }, 500);
  const setup = parseAgentSetup(body.agent, currentAgent);
  if ('error' in setup) return c.json({ error: setup.error }, 400);

  const existing = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
  if (existing) return c.json({ error: 'Project already initialized. Open Settings to change the Agent configuration.' }, 409);

  const template = getTemplate(body.flowTemplate!);
  const compiled = compileFlow(template.definition);
  const repoName = typeof body.repoName === 'string' && body.repoName.trim() ? body.repoName.trim() : path.basename(process.cwd());

  const result = db.transaction(() => {
    db.query(`UPDATE agent_config SET cli_cmd = ?, cli_prompt_mode = ?, cli_prompt_flag = ?, updated_at = datetime('now') WHERE id = 1`)
      .run(setup.config.cli_cmd, setup.config.cli_prompt_mode, setup.config.cli_prompt_flag);
    db.query(`INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, ?, ?)`).run(prefix, repoName);
    const flow = db.query("INSERT INTO flows (name, is_default) VALUES (?, 1)").run(template.name);
    const flowId = Number(flow.lastInsertRowid);
    const version = db.query(`INSERT INTO flow_versions
      (flow_id, version, state, definition_json, compiled_json, published_at)
      VALUES (?, 1, 'published', ?, ?, datetime('now'))`).run(flowId, JSON.stringify(template.definition), JSON.stringify(compiled));
    const versionId = Number(version.lastInsertRowid);
    db.query('UPDATE flows SET active_version_id = ? WHERE id = ?').run(versionId, flowId);
    return { flowId, versionId };
  })();

  const projectConfig = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get()!;
  return c.json({ projectConfig, flow: { id: result.flowId, versionId: result.versionId } }, 201);
});

export default init;
