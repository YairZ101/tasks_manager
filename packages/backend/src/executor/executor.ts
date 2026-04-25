import { getDb } from '../db/database.js';
import { broadcaster } from '../sse/broadcaster.js';
import type { Task, AgentConfig, AgentAdapter, AgentResult } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import { ApiAdapter } from '../agents/api-adapter.js';

interface MutexState {
  held: boolean;
  taskKey: string | null;
  taskId: number | null;
  abortController: AbortController | null;
}

const mutex: MutexState = {
  held: false,
  taskKey: null,
  taskId: null,
  abortController: null,
};

export function getMutexState(): { held: boolean; taskKey: string | null; taskId: number | null } {
  return { held: mutex.held, taskKey: mutex.taskKey, taskId: mutex.taskId };
}

function getAdapter(config: AgentConfig): AgentAdapter {
  if (config.type === 'cli') {
    return new CliAdapter(config);
  }
  return new ApiAdapter(config);
}

function buildPrompt(task: Task, workingDir: string): string {
  const parts: string[] = [];
  parts.push(`You are working in the repository at: ${workingDir}`);
  parts.push('');
  parts.push(`## Task: ${task.task_key} — ${task.title}`);

  if (task.description) {
    parts.push('');
    parts.push('### Description');
    parts.push(task.description);
  }

  if (task.acceptance) {
    parts.push('');
    parts.push('### Acceptance Criteria');
    parts.push(task.acceptance);
  }

  parts.push('');
  parts.push('Please implement the changes needed to complete this task.');

  return parts.join('\n');
}

export async function startAgent(
  taskId: number,
  workingDir: string
): Promise<Task> {
  const db = getDb();

  // Check mutex BEFORE modifying DB
  if (mutex.held) {
    const error: any = new Error(`Agent is busy with ${mutex.taskKey}`);
    error.status = 409;
    error.busyTaskKey = mutex.taskKey;
    throw error;
  }

  // Acquire mutex
  mutex.held = true;

  try {
    // Get the task
    const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 });
    }

    mutex.taskKey = task.task_key;
    mutex.taskId = task.id;

    // Update task status to in-progress
    const maxOrder = db
      .query<{ max_order: number | null }, [string]>(
        `SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?`
      )
      .get('in-progress');
    const newOrder = (maxOrder?.max_order ?? 0) + 1.0;

    db.query(
      `UPDATE tasks SET status = 'in-progress', agent_status = 'running', sort_order = ? WHERE id = ?`
    ).run(newOrder, taskId);

    // Get updated task
    const updatedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;

    // Calculate run number
    const runRow = db
      .query<{ max_run: number | null }, [number]>(
        `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
      )
      .get(taskId);
    const runNumber = ((runRow?.max_run ?? 0) || 0) + 1;

    // Load agent config
    const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
    if (!config) {
      throw Object.assign(new Error('Agent not configured'), { status: 400 });
    }

    // Broadcast task update
    broadcaster.broadcast('task:updated', { task: updatedTask });
    broadcaster.broadcast('agent:status', { taskId, status: 'running' });

    // Create abort controller
    const abortController = new AbortController();
    mutex.abortController = abortController;

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      abortController.abort();
    }, config.timeout_ms);

    // Get adapter and build prompt
    const adapter = getAdapter(config);
    const prompt = buildPrompt(updatedTask, workingDir);

    // Provide prompt to adapter by setting it on the task
    const taskWithPrompt = { ...updatedTask, _prompt: prompt };

    // Track log failures
    let logsFailing = false;
    let lostLogCount = 0;

    // Execute agent in the background
    const executeAgent = async () => {
      try {
        const result: AgentResult = await adapter.execute({
          task: taskWithPrompt,
          workingDir,
          onOutput: (line: string) => {
            if (!logsFailing) {
              try {
                db.query(
                  `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'agent', ?)`
                ).run(taskId, runNumber, line);
              } catch {
                logsFailing = true;
                lostLogCount++;
              }
            } else {
              lostLogCount++;
            }

            broadcaster.broadcast('task:log', {
              taskId,
              log: {
                timestamp: new Date().toISOString(),
                level: 'agent',
                message: line,
                runNumber,
              },
            });
          },
          signal: abortController.signal,
        });

        clearTimeout(timeoutTimer);

        // Log lost lines warning
        if (lostLogCount > 0) {
          try {
            db.query(
              `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'warn', ?)`
            ).run(taskId, runNumber, `${lostLogCount} log lines were lost due to storage error.`);
          } catch {
            // Nothing we can do
          }
        }

        if (result.success) {
          // Move to done
          const maxDoneOrder = db
            .query<{ max_order: number | null }, [string]>(
              `SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?`
            )
            .get('done');
          const doneOrder = (maxDoneOrder?.max_order ?? 0) + 1.0;

          db.query(
            `UPDATE tasks SET status = 'done', agent_status = 'completed', agent_pid = NULL, agent_started_at = NULL, sort_order = ? WHERE id = ?`
          ).run(doneOrder, taskId);

          const finalTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
          broadcaster.broadcast('task:updated', { task: finalTask });
          broadcaster.broadcast('agent:status', { taskId, status: 'completed' });
          broadcaster.broadcast('toast', {
            type: 'success',
            message: `${task.task_key} completed successfully.`,
          });
        } else {
          db.query(
            `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
          ).run(taskId);

          const finalTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
          broadcaster.broadcast('task:updated', { task: finalTask });
          broadcaster.broadcast('agent:status', { taskId, status: 'failed' });
          broadcaster.broadcast('toast', {
            type: 'error',
            message: `${task.task_key} failed: ${result.summary}`,
          });
        }
      } catch (err: any) {
        clearTimeout(timeoutTimer);

        const isTimeout = abortController.signal.aborted;
        const message = isTimeout
          ? `timed out after ${Math.round(config.timeout_ms / 60000)}m`
          : (err?.message || 'unknown error');

        db.query(
          `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
        ).run(taskId);

        try {
          db.query(
            `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'error', ?)`
          ).run(taskId, runNumber, message);
        } catch {
          // Storage error
        }

        const finalTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
        broadcaster.broadcast('task:updated', { task: finalTask });
        broadcaster.broadcast('agent:status', { taskId, status: 'failed' });
        broadcaster.broadcast('toast', {
          type: 'error',
          message: `${task.task_key} failed: ${message}`,
        });
      } finally {
        // Release mutex
        mutex.held = false;
        mutex.taskKey = null;
        mutex.taskId = null;
        mutex.abortController = null;
      }
    };

    // Fire and forget — the agent runs in the background
    executeAgent();

    return updatedTask;
  } catch (err: any) {
    // If we fail before actually starting the agent, release mutex
    if (mutex.taskId === taskId || !mutex.taskId) {
      mutex.held = false;
      mutex.taskKey = null;
      mutex.taskId = null;
      mutex.abortController = null;
    }
    throw err;
  }
}

export async function cancelAgent(taskId: number): Promise<Task> {
  const db = getDb();

  const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) {
    throw Object.assign(new Error('Task not found'), { status: 404 });
  }

  if (task.agent_status !== 'running') {
    throw Object.assign(new Error('No agent running on this task'), { status: 400 });
  }

  // Abort the agent
  if (mutex.abortController && mutex.taskId === taskId) {
    mutex.abortController.abort();
  }

  // The executor's finally block will release the mutex and update status
  // But we need to wait a bit for that to happen
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Update status in case the abort didn't trigger the finally block yet
  db.query(
    `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
  ).run(taskId);

  const runRow = db
    .query<{ max_run: number | null }, [number]>(
      `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
    )
    .get(taskId);
  const runNumber = runRow?.max_run ?? 1;

  try {
    db.query(
      `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'info', 'Agent cancelled by user.')`
    ).run(taskId, runNumber);
  } catch {
    // Storage error
  }

  const updatedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
  broadcaster.broadcast('task:updated', { task: updatedTask });
  broadcaster.broadcast('agent:status', { taskId, status: 'failed' });
  broadcaster.broadcast('toast', {
    type: 'info',
    message: `${task.task_key} cancelled.`,
  });

  return updatedTask;
}

export function shutdownAgent(): void {
  if (mutex.held && mutex.abortController) {
    mutex.abortController.abort();

    if (mutex.taskId) {
      const db = getDb();
      db.query(
        `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
      ).run(mutex.taskId);

      const runRow = db
        .query<{ max_run: number | null }, [number]>(
          `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
        )
        .get(mutex.taskId);
      const runNumber = runRow?.max_run ?? 1;

      try {
        db.query(
          `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'error', 'Server shutting down — agent run aborted.')`
        ).run(mutex.taskId, runNumber);
      } catch {
        // Storage error
      }
    }

    mutex.held = false;
    mutex.taskKey = null;
    mutex.taskId = null;
    mutex.abortController = null;
  }
}
