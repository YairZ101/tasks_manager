import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { startAgent, cancelAgent } from '../executor/executor.js';
import { isWorkflowStep, getFirstWorkflowStep } from '../workflow/workflow-utils.js';
import type { Task } from '../types.js';

const agentControl = new Hono();

// POST /tasks/:id/agent/start
agentControl.post('/start', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  const db = getDb();
  const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Determine target step: if task is in todo, go to first workflow step.
  // If already in a workflow step, re-run on that step.
  let targetSlug: string;
  if (task.status === 'todo' || task.status === 'backlog') {
    const firstStep = getFirstWorkflowStep();
    if (!firstStep) {
      return c.json({ error: 'No workflow steps configured' }, 400);
    }
    targetSlug = firstStep.slug;
  } else if (isWorkflowStep(task.status)) {
    targetSlug = task.status;
  } else {
    return c.json({ error: 'Cannot start agent on a task in status: ' + task.status }, 400);
  }

  try {
    const workingDir = process.cwd();
    const updatedTask = await startAgent(id, workingDir, targetSlug);
    return c.json({ task: updatedTask });
  } catch (err: any) {
    const statusCode = err.status || 500;
    const body: any = { error: err.message };
    if (err.reason) body.reason = err.reason;
    if (err.taskKey) body.taskKey = err.taskKey;
    if (err.activeRuns) body.activeRuns = err.activeRuns;
    return c.json(body, statusCode);
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
