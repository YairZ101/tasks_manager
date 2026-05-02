import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from '../db/database.js';
import tasksRoutes from './tasks.js';
import logsRoutes from './logs.js';
import agentConfigRoutes from './agent-config.js';
import initRoutes from './init.js';
import workflowStepsRoutes from './workflow-steps.js';

function createApp() {
  const app = new Hono();
  app.route('/tasks/:id/logs', logsRoutes);
  app.route('/tasks', tasksRoutes);
  app.route('/agent-config', agentConfigRoutes);
  app.route('/workflow-steps', workflowStepsRoutes);
  app.route('/init', initRoutes);
  return app;
}

describe('Tasks routes (real)', () => {
  let app: Hono;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-routes-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('development', 'Development', 0, '{}', 1.0)").run();
    app = createApp();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /tasks returns empty list', async () => {
    const res = await app.request('/tasks');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toEqual([]);
  });

  test('POST /tasks creates a task with auto key', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'My Task' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.task.task_key).toBe('TST-1');
    expect(data.task.status).toBe('backlog');
  });

  test('POST /tasks with status=todo', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Todo', status: 'todo' }),
    });
    expect(res.status).toBe(201);
    const { task } = await res.json();
    expect(task.status).toBe('todo');
  });

  test('POST /tasks rejects missing title', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('POST /tasks rejects in-progress as create status', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad', status: 'in-progress' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /tasks rejects invalid JSON', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  test('GET /tasks/:id returns a task', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Find Me' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.title).toBe('Find Me');
  });

  test('GET /tasks/:id returns 404', async () => {
    const res = await app.request('/tasks/9999');
    expect(res.status).toBe(404);
  });

  test('GET /tasks/:id returns 400 for NaN', async () => {
    const res = await app.request('/tasks/abc');
    expect(res.status).toBe(400);
  });

  test('PATCH /tasks/:id updates title and description', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Original' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated', description: 'new' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.title).toBe('Updated');
    expect(data.task.description).toBe('new');
  });

  test('PATCH /tasks/:id rejects empty title', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /tasks/:id status change to done', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Finish me', status: 'todo' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.status).toBe('done');
  });

  test('PATCH /tasks/:id blocks backlog from done', async () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-99', 'Done', 'done', 1)"
    ).run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-99'").get() as any;

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'backlog' }),
    });
    expect(res.status).toBe(400);
  });

  test('DELETE /tasks/:id removes task', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Delete Me' }),
    });
    const { task } = await createRes.json();

    const delRes = await app.request(`/tasks/${task.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    const getRes = await app.request(`/tasks/${task.id}`);
    expect(getRes.status).toBe(404);
  });

  test('DELETE blocks on running agent', async () => {
    const db = getDb();
    db.query(
      "INSERT INTO tasks (task_key, title, status, agent_status, sort_order) VALUES ('TST-99', 'Running', 'development', 'running', 1)"
    ).run();
    const task = db.query("SELECT id FROM tasks WHERE task_key = 'TST-99'").get() as any;

    const res = await app.request(`/tasks/${task.id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  test('GET /tasks?q= filters by query', async () => {
    await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Alpha' }),
    });
    await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Beta' }),
    });

    const res = await app.request('/tasks?q=Alpha');
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe('Alpha');
  });

  test('GET /tasks?status= filters by status', async () => {
    await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'BL', status: 'backlog' }),
    });
    await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'TD', status: 'todo' }),
    });

    const res = await app.request('/tasks?status=todo');
    const data = await res.json();
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe('TD');
  });

  test('PATCH /tasks/:id returns 404 for missing task', async () => {
    const res = await app.request('/tasks/9999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCH /tasks/:id returns 400 for NaN id', async () => {
    const res = await app.request('/tasks/abc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /tasks/:id rejects invalid JSON', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Valid' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /tasks/:id rejects invalid status value', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Task' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /tasks/:id rejects non-finite sort_order', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Task' }),
    });
    const { task } = await createRes.json();

    const res = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: Infinity }),
    });
    expect(res.status).toBe(400);
  });

  test('DELETE /tasks/:id returns 400 for NaN id', async () => {
    const res = await app.request('/tasks/abc', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  test('DELETE /tasks/:id returns 404 for non-existent', async () => {
    const res = await app.request('/tasks/9999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('Logs routes (real)', () => {
  let app: Hono;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-routes-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('development', 'Development', 0, '{}', 1.0)").run();
    app = createApp();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /tasks/:id/logs returns logs', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Logged Task' }),
    });
    const { task } = await createRes.json();

    const db = getDb();
    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'info', 'hello')").run(task.id);

    const res = await app.request(`/tasks/${task.id}/logs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toHaveLength(1);
    expect(data.logs[0].message).toBe('hello');
  });

  test('GET /tasks/:id/logs pagination', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Task' }),
    });
    const { task } = await createRes.json();

    const db = getDb();
    for (let i = 0; i < 5; i++) {
      db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'info', ?)").run(task.id, `log-${i}`);
    }

    const res = await app.request(`/tasks/${task.id}/logs?limit=3`);
    const data = await res.json();
    expect(data.logs).toHaveLength(3);
    expect(data.hasMore).toBe(true);
  });

  test('GET /tasks/:id/logs filters by run_number', async () => {
    const createRes = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Task' }),
    });
    const { task } = await createRes.json();

    const db = getDb();
    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 1, 'info', 'run1')").run(task.id);
    db.query("INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, 2, 'info', 'run2')").run(task.id);

    const res = await app.request(`/tasks/${task.id}/logs?run_number=2`);
    const data = await res.json();
    expect(data.logs).toHaveLength(1);
    expect(data.logs[0].message).toBe('run2');
  });
});

describe('Agent config routes (real)', () => {
  let app: Hono;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-routes-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    app = createApp();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /agent-config returns defaults', async () => {
    const res = await app.request('/agent-config');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.type).toBe('cli');
    expect(data.config.timeout_ms).toBe(1800000);
  });

  test('PUT /agent-config updates fields', async () => {
    const res = await app.request('/agent-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cli_cmd: 'test-cmd', timeout_ms: 60000 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.cli_cmd).toBe('test-cmd');
    expect(data.config.timeout_ms).toBe(60000);
  });

  test('PUT /agent-config rejects low timeout', async () => {
    const res = await app.request('/agent-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout_ms: 100 }),
    });
    expect(res.status).toBe(400);
  });

  test('PUT /agent-config rejects invalid cli_prompt_mode', async () => {
    const res = await app.request('/agent-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cli_prompt_mode: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  test('PUT /agent-config rejects invalid JSON', async () => {
    const res = await app.request('/agent-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('Init routes (real)', () => {
  let app: Hono;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-routes-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    app = createApp();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('POST /init/save-prefix saves valid prefix', async () => {
    const res = await app.request('/init/save-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'PROJ', repoName: 'my-repo' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projectConfig.task_prefix).toBe('PROJ');
  });

  test('POST /init/save-prefix uppercases', async () => {
    const res = await app.request('/init/save-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'abc' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projectConfig.task_prefix).toBe('ABC');
  });

  test('POST /init/save-prefix rejects missing prefix', async () => {
    const res = await app.request('/init/save-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('POST /init/save-prefix rejects too-long prefix', async () => {
    const res = await app.request('/init/save-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'ABCDEF' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /init/save-prefix rejects double init', async () => {
    await app.request('/init/save-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'PROJ' }),
    });

    const res = await app.request('/init/save-prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'REDO' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('already initialized');
  });
});

describe('Workflow steps routes (real)', () => {
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-routes-'));
    fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
    initDb(tmpDir);
    const db = getDb();
    db.query("INSERT INTO project_config (id, task_prefix, repo_name) VALUES (1, 'TST', 'test-repo')").run();
    db.query("INSERT INTO workflow_steps (slug, name, requires_review, config, sort_order) VALUES ('development', 'Development', 0, '{}', 1.0)").run();
    app = createApp();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('GET /workflow-steps returns active steps', async () => {
    const res = await app.request('/workflow-steps');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].slug).toBe('development');
  });

  test('GET /workflow-steps/catalog returns catalog with active flags', async () => {
    const res = await app.request('/workflow-steps/catalog');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.catalog.length).toBeGreaterThan(0);
    const dev = data.catalog.find((s: any) => s.slug === 'development');
    expect(dev.active).toBe(true);
    const planning = data.catalog.find((s: any) => s.slug === 'planning');
    expect(planning.active).toBe(false);
  });

  test('POST /workflow-steps adds a step from the catalog', async () => {
    const res = await app.request('/workflow-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'planning' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.step.slug).toBe('planning');
    expect(data.step.name).toBe('Planning');
  });

  test('POST /workflow-steps rejects unknown slug', async () => {
    const res = await app.request('/workflow-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'nonexistent' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /workflow-steps rejects duplicate slug', async () => {
    const res = await app.request('/workflow-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'development' }),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /workflow-steps/:id updates sort_order', async () => {
    const db = getDb();
    const step = db.query("SELECT id FROM workflow_steps WHERE slug = 'development'").get() as any;

    const res = await app.request(`/workflow-steps/${step.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: 5.0 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.step.sort_order).toBe(5.0);
  });

  test('PATCH /workflow-steps/:id updates requires_review', async () => {
    const db = getDb();
    const step = db.query("SELECT id FROM workflow_steps WHERE slug = 'development'").get() as any;

    const res = await app.request(`/workflow-steps/${step.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requires_review: true }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.step.requires_review).toBe(1);
  });

  test('DELETE /workflow-steps/:id removes a step', async () => {
    // Add a second step so we can delete one
    await app.request('/workflow-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'planning' }),
    });

    const db = getDb();
    const step = db.query("SELECT id FROM workflow_steps WHERE slug = 'planning'").get() as any;

    const res = await app.request(`/workflow-steps/${step.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move_tasks_to: 'todo' }),
    });
    expect(res.status).toBe(204);

    const remaining = db.query("SELECT * FROM workflow_steps").all();
    expect(remaining).toHaveLength(1);
  });

  test('DELETE /workflow-steps/:id blocks removing last step', async () => {
    const db = getDb();
    const step = db.query("SELECT id FROM workflow_steps WHERE slug = 'development'").get() as any;

    const res = await app.request(`/workflow-steps/${step.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move_tasks_to: 'todo' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('last workflow step');
  });

  test('DELETE /workflow-steps/:id moves tasks when step has tasks', async () => {
    const db = getDb();
    // Add a second step
    await app.request('/workflow-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'planning' }),
    });

    // Create a task in the planning step
    db.query("INSERT INTO tasks (task_key, title, status, sort_order) VALUES ('TST-1', 'Test', 'planning', 1)").run();

    const step = db.query("SELECT id FROM workflow_steps WHERE slug = 'planning'").get() as any;
    const res = await app.request(`/workflow-steps/${step.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move_tasks_to: 'todo' }),
    });
    expect(res.status).toBe(204);

    const task = db.query("SELECT status FROM tasks WHERE task_key = 'TST-1'").get() as any;
    expect(task.status).toBe('todo');
  });
});
