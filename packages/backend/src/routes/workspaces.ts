import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { cleanupWorkspace, inspectWorkspace } from '../flow/workspaces.js';
import type { Workspace } from '../types.js';

const workspaces = new Hono();

workspaces.get('/:id', async (c) => {
  const workspace = getDb().query<Workspace, [number]>('SELECT * FROM workspaces WHERE id = ?').get(Number(c.req.param('id')));
  if (!workspace) return c.json({ error: 'Workspace not found.' }, 404);
  return c.json({ workspace, inspection: await inspectWorkspace(workspace) });
});

workspaces.delete('/:id', async (c) => {
  await cleanupWorkspace(Number(c.req.param('id')), c.req.query('force') === 'true');
  return c.body(null, 204);
});

export default workspaces;
