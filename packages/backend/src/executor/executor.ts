import { getDb } from '../db/database.js';
import { broadcaster } from '../sse/broadcaster.js';
import type { Task, AgentConfig, AgentAdapter, AgentResult } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import { ApiAdapter } from '../agents/api-adapter.js';

interface MutexState {
  held: boolean;
  taskKey: string | null;
  taskId: number | null;
  runNumber: number | null;
  abortController: AbortController | null;
  completionPromise: Promise<void> | null;
  resolveCompletion: (() => void) | null;
  cancelling: boolean;
}

const mutex: MutexState = {
  held: false,
  taskKey: null,
  taskId: null,
  runNumber: null,
  abortController: null,
  completionPromise: null,
  cancelling: false,
  resolveCompletion: null,
};

export function getMutexState(): { held: boolean; taskKey: string | null; taskId: number | null } {
  return { held: mutex.held, taskKey: mutex.taskKey, taskId: mutex.taskId };
}

export async function awaitCompletion(): Promise<void> {
  if (mutex.completionPromise) {
    await mutex.completionPromise;
  }
}

function getAdapter(config: AgentConfig): AgentAdapter {
  if (config.type === 'cli') {
    return new CliAdapter(config);
  }
  return new ApiAdapter(config);
}

export function buildPrompt(task: Task, workingDir: string): string {
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

  let originalTask: Task | null = null;

  try {
    // Get the task
    const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 });
    }

    originalTask = task;
    mutex.taskKey = task.task_key;
    mutex.taskId = task.id;

    // Update task status to in-progress (transactional)
    const prepareRun = db.transaction(() => {
      const maxOrder = db
        .query<{ max_order: number | null }, [string]>(
          `SELECT MAX(sort_order) as max_order FROM tasks WHERE status = ?`
        )
        .get('in-progress');
      const newOrder = (maxOrder?.max_order ?? 0) + 1.0;

      db.query(
        `UPDATE tasks SET status = 'in-progress', agent_status = 'running', sort_order = ? WHERE id = ?`
      ).run(newOrder, taskId);

      const runRow = db
        .query<{ max_run: number | null }, [number]>(
          `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
        )
        .get(taskId);
      const runNumber = ((runRow?.max_run ?? 0) || 0) + 1;

      const updatedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
      return { updatedTask, runNumber };
    });

    const { updatedTask, runNumber } = prepareRun();
    mutex.runNumber = runNumber;

    // Load agent config
    const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
    if (!config) {
      throw Object.assign(new Error('Agent not configured'), { status: 400 });
    }

    // Broadcast task update
    broadcaster.broadcast('task:updated', { task: updatedTask });
    broadcaster.broadcast('agent:status', { taskId, status: 'running', runNumber });

    // Create abort controller and completion promise
    const abortController = new AbortController();
    mutex.abortController = abortController;
    let resolveCompletion: () => void;
    mutex.completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    mutex.resolveCompletion = resolveCompletion!;

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      abortController.abort('timeout');
    }, config.timeout_ms);

    // Get adapter and build prompt
    const adapter = getAdapter(config);
    const prompt = buildPrompt(updatedTask, workingDir);

    // Track log failures
    let logsFailing = false;
    let lostLogCount = 0;

    const broadcastLog = (level: string, message: string) => {
      broadcaster.broadcast('task:log', {
        taskId,
        log: {
          task_id: taskId,
          run_number: runNumber,
          timestamp: new Date().toISOString(),
          level,
          message,
        },
      });
    };

    // Buffered DB log writer — batches inserts into transactions
    const logBuffer: { level: string; message: string }[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const insertLogStmt = db.query(
      `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, ?, ?)`
    );

    const flushLogBuffer = () => {
      flushTimer = null;
      if (logBuffer.length === 0 || logsFailing) return;

      const batch = logBuffer.splice(0);
      try {
        db.transaction(() => {
          for (const entry of batch) {
            insertLogStmt.run(taskId, runNumber, entry.level, entry.message);
          }
        })();
      } catch (err) {
        console.error('Failed to flush log buffer:', err);
        logsFailing = true;
        lostLogCount += batch.length;
      }
    };

    const scheduleFlush = () => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(flushLogBuffer, 50);
    };

    const queueLog = (level: string, message: string) => {
      if (logsFailing) {
        lostLogCount++;
        return;
      }
      logBuffer.push({ level, message });
      scheduleFlush();
    };

    // Execute agent in the background
    const executeAgent = async () => {
      try {
        const result: AgentResult = await adapter.execute({
          task: updatedTask,
          prompt,
          workingDir,
          onOutput: (line: string) => {
            queueLog('agent', line);
            broadcastLog('agent', line);
          },
          signal: abortController.signal,
        });

        clearTimeout(timeoutTimer);

        // Flush remaining buffered logs
        if (flushTimer) clearTimeout(flushTimer);
        flushLogBuffer();

        // Log lost lines warning
        if (lostLogCount > 0) {
          const warnMsg = `${lostLogCount} log lines were lost due to storage error.`;
          try {
            insertLogStmt.run(taskId, runNumber, 'warn', warnMsg);
          } catch (err) {
            console.error('Failed to write lost-log warning:', err);
          }
          broadcastLog('warn', warnMsg);
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
        if (flushTimer) clearTimeout(flushTimer);
        flushLogBuffer();

        const isTimeout = abortController.signal.reason === 'timeout';
        const isCancelled = abortController.signal.aborted && !isTimeout;

        try {
          db.query(
            `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
          ).run(taskId);

          if (!isCancelled) {
            const message = isTimeout
              ? `timed out after ${config.timeout_ms >= 60000 ? `${Math.round(config.timeout_ms / 60000)}m` : `${Math.round(config.timeout_ms / 1000)}s`}`
              : (err?.message || 'unknown error');

            try {
              insertLogStmt.run(taskId, runNumber, 'error', message);
            } catch (err) {
              console.error('Failed to write error log:', err);
            }
            broadcastLog('error', message);

            const finalTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
            broadcaster.broadcast('task:updated', { task: finalTask });
            broadcaster.broadcast('agent:status', { taskId, status: 'failed' });
            broadcaster.broadcast('toast', {
              type: 'error',
              message: `${task.task_key} failed: ${message}`,
            });
          }
        } catch {
          // DB may have been closed during shutdown — cleanup was already handled
        }
      } finally {
        // Release mutex
        const resolve = mutex.resolveCompletion;
        mutex.held = false;
        mutex.taskKey = null;
        mutex.taskId = null;
        mutex.runNumber = null;
        mutex.abortController = null;
        mutex.completionPromise = null;
        mutex.resolveCompletion = null;
        mutex.cancelling = false;
        resolve?.();
      }
    };

    // Fire and forget — the agent runs in the background
    executeAgent();

    return updatedTask;
  } catch (err: any) {
    // If we fail before actually starting the agent, release mutex and rollback DB
    if (mutex.taskId === taskId || !mutex.taskId) {
      if (originalTask) {
        try {
          db.query(
            `UPDATE tasks SET status = ?, agent_status = ?, sort_order = ? WHERE id = ?`
          ).run(originalTask.status, originalTask.agent_status, originalTask.sort_order, taskId);
          broadcaster.broadcast('task:updated', { task: originalTask });
        } catch {
          // Best effort rollback
        }
      }

      const resolve = mutex.resolveCompletion;
      mutex.held = false;
      mutex.taskKey = null;
      mutex.taskId = null;
      mutex.runNumber = null;
      mutex.abortController = null;
      mutex.completionPromise = null;
      mutex.resolveCompletion = null;
      mutex.cancelling = false;
      resolve?.();
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

  // Only the first concurrent cancel actually aborts and logs; subsequent ones just wait
  const completionPromise = mutex.completionPromise;
  const currentRunNumber = mutex.runNumber;
  const isCanceller = !mutex.cancelling && mutex.abortController != null && mutex.taskId === taskId;
  if (isCanceller) {
    mutex.cancelling = true;
    mutex.abortController!.abort();
  }

  if (completionPromise) {
    await completionPromise;
  }

  // Re-read task after the executor has finished — it may have completed or failed on its own
  // before the abort signal was processed.
  const postTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;

  if (!isCanceller || postTask.agent_status === 'completed') {
    return postTask;
  }

  // Ensure status is set (executor may have set 'failed' already, this is idempotent)
  db.query(
    `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
  ).run(taskId);

  // Use the run number from the mutex (the current run), falling back to MAX from DB
  const runNumber = currentRunNumber
    ?? db.query<{ max_run: number | null }, [number]>(
      `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
    ).get(taskId)?.max_run
    ?? 1;

  try {
    db.query(
      `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'info', 'Agent cancelled by user.')`
    ).run(taskId, runNumber);
  } catch (err) {
    console.error('Failed to write cancel log:', err);
  }

  broadcaster.broadcast('task:log', {
    taskId,
    log: {
      task_id: taskId,
      run_number: runNumber,
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Agent cancelled by user.',
    },
  });

  const updatedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
  broadcaster.broadcast('task:updated', { task: updatedTask });
  broadcaster.broadcast('agent:status', { taskId, status: 'failed' });
  broadcaster.broadcast('toast', {
    type: 'info',
    message: `${task.task_key} cancelled.`,
  });

  return updatedTask;
}

export function shutdownAgent(): number | null {
  if (mutex.held && mutex.abortController) {
    mutex.abortController.abort();

    let agentPid: number | null = null;

    if (mutex.taskId) {
      const db = getDb();

      const task = db.query<Task, [number]>('SELECT agent_pid FROM tasks WHERE id = ?').get(mutex.taskId);
      agentPid = task?.agent_pid ?? null;

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
      } catch (err) {
        console.error('Failed to write shutdown log:', err);
      }
    }

    const resolve = mutex.resolveCompletion;
    mutex.held = false;
    mutex.taskKey = null;
    mutex.taskId = null;
    mutex.runNumber = null;
    mutex.abortController = null;
    mutex.completionPromise = null;
    mutex.resolveCompletion = null;
    resolve?.();

    return agentPid;
  }
  return null;
}
