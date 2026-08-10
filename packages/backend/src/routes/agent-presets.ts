import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import type { AgentPreset } from '../types.js';

const agentPresets = new Hono();

function validatePreset(body: Record<string, unknown>, partial = false): string | null {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 120) return 'Name must be between 1 and 120 characters.';
  }
  if (!partial || body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 500) return 'Description must be 500 characters or fewer.';
  }
  if (!partial || body.system_prompt !== undefined) {
    if (typeof body.system_prompt !== 'string' || body.system_prompt.trim().length < 1 || body.system_prompt.length > 50_000) return 'System prompt must be between 1 and 50,000 characters.';
  }
  return null;
}

function createPresetKey(name: string): string {
  const db = getDb();
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 68) || 'agent';
  let key = base;
  let suffix = 2;
  while (db.query<{ id: number }, [string]>('SELECT id FROM agent_presets WHERE preset_key = ?').get(key)) key = `${base}-${suffix++}`;
  return key;
}

agentPresets.get('/', (c) => {
  const presets = getDb().query<AgentPreset, []>('SELECT * FROM agent_presets ORDER BY name COLLATE NOCASE, id').all();
  return c.json({ presets });
});

agentPresets.post('/', async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const problem = validatePreset(body);
  if (problem) return c.json({ error: problem }, 400);
  const db = getDb();
  const result = db.query('INSERT INTO agent_presets (preset_key, name, description, system_prompt) VALUES (?, ?, ?, ?)')
    .run(createPresetKey(body.name as string), (body.name as string).trim(), (body.description as string).trim(), (body.system_prompt as string).trim());
  const preset = db.query<AgentPreset, [number]>('SELECT * FROM agent_presets WHERE id = ?').get(Number(result.lastInsertRowid))!;
  return c.json({ preset }, 201);
});

agentPresets.patch('/:id', async (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || !db.query<AgentPreset, [number]>('SELECT * FROM agent_presets WHERE id = ?').get(id)) return c.json({ error: 'Agent preset not found.' }, 404);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);
  const problem = validatePreset(body, true);
  if (problem) return c.json({ error: problem }, 400);
  const updates: string[] = [];
  const params: string[] = [];
  for (const field of ['name', 'description', 'system_prompt'] as const) {
    if (body[field] === undefined) continue;
    updates.push(`${field} = ?`);
    params.push((body[field] as string).trim());
  }
  if (updates.length) db.query(`UPDATE agent_presets SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
  return c.json({ preset: db.query<AgentPreset, [number]>('SELECT * FROM agent_presets WHERE id = ?').get(id)! });
});

agentPresets.delete('/:id', (c) => {
  const db = getDb();
  const id = Number(c.req.param('id'));
  const preset = db.query<AgentPreset, [number]>('SELECT * FROM agent_presets WHERE id = ?').get(id);
  if (!preset) return c.json({ error: 'Agent preset not found.' }, 404);
  // An agent may not be deleted while a Flow's live draft or active version still uses it, since
  // its prompt is resolved from the library at run start.
  const usedBy = db.query<{ name: string }, [string]>(`
    SELECT DISTINCT f.name FROM flow_versions fv
    JOIN flows f ON f.id = fv.flow_id,
    json_each(fv.definition_json, '$.nodes') node
    WHERE (fv.state = 'draft' OR fv.id = f.active_version_id)
      AND json_extract(node.value, '$.type') = 'agent'
      AND json_extract(node.value, '$.config.preset') = ?
    ORDER BY f.name
  `).all(preset.preset_key);
  if (usedBy.length) {
    const names = usedBy.map((flow) => `“${flow.name}”`).join(', ');
    return c.json({ error: `This agent is used by ${usedBy.length} Flow${usedBy.length === 1 ? '' : 's'} (${names}). Replace or remove the Agent block there first.`, reason: 'agent_in_use', flows: usedBy.map((flow) => flow.name) }, 409);
  }
  db.query('DELETE FROM agent_presets WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default agentPresets;
