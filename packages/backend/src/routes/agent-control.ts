import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { startAgent, cancelAgent } from '../executor/executor.js';

const agentControl = new Hono();

// POST /tasks/:id/agent/start
agentControl.post('/start', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  try {
    const workingDir = process.cwd();
    const task = await startAgent(id, workingDir);
    return c.json({ task });
  } catch (err: any) {
    const statusCode = err.status || 500;
    return c.json(
      { error: err.message, busyTaskKey: err.busyTaskKey },
      statusCode
    );
  }
});

// POST /tasks/:id/agent/cancel
agentControl.post('/cancel', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  try {
    const task = await cancelAgent(id);
    return c.json({ task });
  } catch (err: any) {
    const statusCode = err.status || 500;
    return c.json({ error: err.message }, statusCode);
  }
});

export default agentControl;
