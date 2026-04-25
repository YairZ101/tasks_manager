import { Hono } from 'hono';
import { getDb } from '../db/database.js';
import { startAgent, getMutexState } from '../executor/executor.js';
import type { Task, ProjectConfig } from '../types.js';

const tasks = new Hono();

// GET /tasks — list all tasks
tasks.get('/', (c) => {
  const db = getDb();
  const q = c.req.query('q');
  const status = c.req.query('status');

  let sql = 'SELECT * FROM tasks';
  const conditions: string[] = [];
  const params: any[] = [];

  if (q) {
    conditions.push(`(title LIKE ? OR description LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY sort_order ASC';

  const result = db.query<Task, any[]>(sql).all(...params);
  return c.json({ tasks: result });
});

// POST /tasks — create a task
tasks.post('/', async (c) => {
  const db = getDb();
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { title, description, acceptance, status, run } = body;

  // Validate title
  if (!title || typeof title !== 'string' || title.length < 1 || title.length > 500) {
    return c.json({ error: 'Title is required (1-500 characters)' }, 400);
  }

  // Validate description
  if (description !== undefined && (typeof description !== 'string' || description.length > 50000)) {
    return c.json({ error: 'Description must be at most 50,000 characters' }, 400);
  }

  // Validate acceptance
  if (acceptance !== undefined && (typeof acceptance !== 'string' || acceptance.length > 50000)) {
    return c.json({ error: 'Acceptance criteria must be at most 50,000 characters' }, 400);
  }

  // Validate status
  const validCreateStatuses = ['backlog', 'todo'];
  const taskStatus = status || 'backlog';
  if (!validCreateStatuses.includes(taskStatus)) {
    return c.json({ error: 'Status must be "backlog" or "todo"' }, 400);
  }

  // If run=true, check mutex first
  if (run) {
    const mutexState = getMutexState();
    if (mutexState.held) {
      return c.json(
        { error: `Agent is busy with ${mutexState.taskKey}`, busyTaskKey: mutexState.taskKey },
        409
      );
    }
  }

  // Get project config for prefix
  const projectConfig = db.query<ProjectConfig, []>('SELECT * FROM project_config WHERE id = 1').get();
  if (!projectConfig) {
    return c.json({ error: 'Project not initialized' }, 400);
  }

  // Create task in transaction
  const createTask = db.transaction(() => {
    // Get next task number
    const row = db
      .query<{ seq: number }, []>(
        `UPDATE project_config SET next_task_number = next_task_number + 1 WHERE id = 1 RETURNING next_task_number - 1 AS seq`
      )
      .get();

    if (!row) {
      throw new Error('Failed to get task sequence number');
    }

    const taskKey = `${projectConfig.task_prefix}-${row.seq}`;

    // Calculate sort order
    const maxOrder = db
      .query<{ max_order: number | null }, [string]>(
        `SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?`
      )
      .get(taskStatus);
    const sortOrder = (maxOrder?.max_order ?? 0) + 1.0;

    db.query(
      `INSERT INTO tasks (task_key, title, description, acceptance, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(taskKey, title, description || '', acceptance || '', taskStatus, sortOrder);

    const lastId = db.query<{ id: number }, []>('SELECT last_insert_rowid() as id').get()!.id;
    return db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(lastId)!;
  });

  const task = createTask();

  // Broadcast task creation
  const { broadcaster } = await import('../sse/broadcaster.js');
  broadcaster.broadcast('task:updated', { task });

  // If run=true, start the agent
  if (run) {
    try {
      const workingDir = process.cwd();
      const updatedTask = await startAgent(task.id, workingDir);
      return c.json({ task: updatedTask }, 201);
    } catch (err: any) {
      // Task was created but agent couldn't start — return the task anyway
      return c.json({ task, agentError: err.message }, 201);
    }
  }

  return c.json({ task }, 201);
});

// GET /tasks/:id — get a single task
tasks.get('/:id', (c) => {
  const db = getDb();
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return c.json({ task });
});

// PATCH /tasks/:id — update task
tasks.patch('/:id', async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { title, description, acceptance, status, sort_order } = body;

  // Validate title
  if (title !== undefined && (typeof title !== 'string' || title.length < 1 || title.length > 500)) {
    return c.json({ error: 'Title must be 1-500 characters' }, 400);
  }

  // Validate description
  if (description !== undefined && (typeof description !== 'string' || description.length > 50000)) {
    return c.json({ error: 'Description must be at most 50,000 characters' }, 400);
  }

  // Validate acceptance
  if (acceptance !== undefined && (typeof acceptance !== 'string' || acceptance.length > 50000)) {
    return c.json({ error: 'Acceptance criteria must be at most 50,000 characters' }, 400);
  }

  // Validate sort_order
  if (sort_order !== undefined && (typeof sort_order !== 'number' || !Number.isFinite(sort_order))) {
    return c.json({ error: 'sort_order must be a finite number' }, 400);
  }

  // Handle status change
  if (status && status !== task.status) {
    const validStatuses = ['backlog', 'todo', 'in-progress', 'done'];
    if (!validStatuses.includes(status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }

    // Blocked transitions
    if (status === 'backlog' && (task.status === 'in-progress' || task.status === 'done')) {
      return c.json({ error: 'Cannot move to backlog from ' + task.status }, 400);
    }

    // If moving to in-progress, delegate to executor
    if (status === 'in-progress') {
      try {
        const workingDir = process.cwd();
        const updatedTask = await startAgent(id, workingDir);
        return c.json({ task: updatedTask });
      } catch (err: any) {
        const statusCode = err.status || 500;
        return c.json(
          { error: err.message, busyTaskKey: err.busyTaskKey },
          statusCode
        );
      }
    }

    // If moving away from in-progress while running, cancel agent
    if (task.status === 'in-progress' && task.agent_status === 'running') {
      const { cancelAgent } = await import('../executor/executor.js');
      await cancelAgent(id);
    }

    // Calculate sort_order for target column
    let newSortOrder = sort_order;
    if (newSortOrder === undefined) {
      const maxOrder = db
        .query<{ max_order: number | null }, [string]>(
          `SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?`
        )
        .get(status);
      newSortOrder = (maxOrder?.max_order ?? 0) + 1.0;
    }

    // Determine agent_status after transition
    let newAgentStatus: string | null = task.agent_status;
    if (status === 'todo' || status === 'backlog') {
      newAgentStatus = null;
    }
    // If moving to done, preserve agent_status

    db.query(
      `UPDATE tasks SET status = ?, agent_status = ?, sort_order = ?, agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
    ).run(status, newAgentStatus, newSortOrder, id);
  } else {
    // Non-status updates
    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (acceptance !== undefined) {
      updates.push('acceptance = ?');
      params.push(acceptance);
    }
    if (sort_order !== undefined && !status) {
      updates.push('sort_order = ?');
      params.push(sort_order);
    }

    if (updates.length > 0) {
      params.push(id);
      db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
  }

  const updatedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(id)!;

  // Broadcast
  const { broadcaster } = await import('../sse/broadcaster.js');
  broadcaster.broadcast('task:updated', { task: updatedTask });

  return c.json({ task: updatedTask });
});

// DELETE /tasks/:id — delete task
tasks.delete('/:id', (c) => {
  const db = getDb();
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: 'Invalid task ID' }, 400);
  }

  const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  if (task.agent_status === 'running') {
    return c.json({ error: 'Cannot delete task while agent is running' }, 409);
  }

  db.query('DELETE FROM tasks WHERE id = ?').run(id);

  return c.body(null, 204);
});

export default tasks;
