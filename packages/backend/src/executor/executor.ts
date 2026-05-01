import { getDb } from '../db/database.js';
import { broadcaster } from '../sse/broadcaster.js';
import type { Task, AgentConfig, RunnerState } from '../types.js';
import { CliAdapter } from '../agents/cli-adapter.js';
import {
  isGitRepo,
  createWorktree,
  removeWorktree,
  checkUncommittedChanges,
  detectMainBranch,
  getRecentCommits,
} from '../worktree/worktree.js';

interface RunState {
  taskId: number;
  taskKey: string;
  runNumber: number;
  pid: number | null;
  abortController: AbortController;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
  cancelling: boolean;
  worktreePath: string;
}

const activeRuns = new Map<number, RunState>();

let gitRepoDetected: boolean | null = null;

export function initGitDetection(repoRoot: string): void {
  gitRepoDetected = isGitRepo(repoRoot);
  if (!gitRepoDetected) {
    console.log('Parallel agents require a git repository. Running in single-agent mode.');
  }
}

export function isGitRepoDetected(): boolean {
  return gitRepoDetected === true;
}

function getMaxConcurrent(): number {
  if (!gitRepoDetected) return 1;
  try {
    const config = getDb().query<{ max_concurrent_agents: number }, []>(
      'SELECT max_concurrent_agents FROM agent_config WHERE id = 1'
    ).get();
    return config?.max_concurrent_agents ?? 3;
  } catch {
    return 3;
  }
}

export function getRunnerState(): RunnerState {
  return {
    activeCount: activeRuns.size,
    maxConcurrent: getMaxConcurrent(),
    runs: [...activeRuns.values()].map(r => ({ taskId: r.taskId, taskKey: r.taskKey })),
  };
}

export async function awaitAllCompletions(): Promise<void> {
  await Promise.allSettled(
    [...activeRuns.values()].map(r => r.completionPromise)
  );
}

export interface BuildPromptOpts {
  workingDir: string;
  branchName?: string;
  mainBranch?: string;
  recentCommits?: string;
}

export function buildPrompt(task: Task, opts: BuildPromptOpts): string {
  const parts: string[] = [];

  if (opts.branchName) {
    parts.push(`You are working in a git worktree at: ${opts.workingDir}`);
    parts.push(`You are on branch: ${opts.branchName}`);
    parts.push(`The main branch is: ${opts.mainBranch}`);
  } else {
    parts.push(`You are working in the repository at: ${opts.workingDir}`);
  }

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

  parts.push('');
  parts.push('## Git Guidelines');
  parts.push('');
  parts.push('- When you are done, commit your changes on this branch. Do not leave uncommitted files.');
  parts.push('- If the task involves multiple distinct logical changes, use separate commits for each. Otherwise, a single commit is fine.');
  parts.push('- Write clear commit messages: a short summary line (imperative mood), optionally followed by a blank line and a longer explanation of why the change was made.');

  if (opts.recentCommits) {
    parts.push('- Match the commit message style used in this repo. Recent commits for reference:');
    parts.push('```');
    parts.push(opts.recentCommits);
    parts.push('```');
  }

  return parts.join('\n');
}

export async function startAgent(
  taskId: number,
  workingDir: string
): Promise<Task> {
  const db = getDb();

  // Check if this task is already running
  if (activeRuns.has(taskId)) {
    const run = activeRuns.get(taskId)!;
    const error: any = new Error(`${run.taskKey} is already running`);
    error.status = 409;
    error.reason = 'task_already_running';
    error.taskKey = run.taskKey;
    throw error;
  }

  // Check concurrency limit
  const maxConcurrent = getMaxConcurrent();
  if (activeRuns.size >= maxConcurrent) {
    const error: any = new Error(`Concurrency limit reached (${activeRuns.size}/${maxConcurrent} running)`);
    error.status = 409;
    error.reason = 'concurrency_limit';
    error.activeRuns = getRunnerState().runs;
    throw error;
  }

  // Reserve the slot immediately to prevent races
  let resolveCompletion!: () => void;
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const abortController = new AbortController();

  const runState: RunState = {
    taskId,
    taskKey: '', // will be set after task lookup
    runNumber: 0,
    pid: null,
    abortController,
    completionPromise,
    resolveCompletion,
    cancelling: false,
    worktreePath: '',
  };
  activeRuns.set(taskId, runState);

  let originalTask: Task | null = null;

  try {
    // Get the task
    const task = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 });
    }

    originalTask = task;
    runState.taskKey = task.task_key;

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
      const runNumber = (runRow?.max_run ?? 0) + 1;

      const updatedTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
      return { updatedTask, runNumber };
    });

    const { updatedTask, runNumber } = prepareRun();
    runState.runNumber = runNumber;

    // Load agent config
    const config = db.query<AgentConfig, []>('SELECT * FROM agent_config WHERE id = 1').get();
    if (!config) {
      throw Object.assign(new Error('Agent not configured'), { status: 400 });
    }

    // Broadcast task update
    broadcaster.broadcast('task:updated', { task: updatedTask });
    broadcaster.broadcast('agent:status', {
      taskId,
      taskKey: updatedTask.task_key,
      status: 'running',
      runNumber,
    });

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      abortController.abort('timeout');
    }, config.timeout_ms);

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

    // Buffered DB log writer
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
      let effectiveDir = workingDir;
      const useWorktree = gitRepoDetected === true;
      let branchName: string | undefined;
      let mainBranch: string | undefined;

      try {
        // Create worktree if in git mode
        if (useWorktree) {
          mainBranch = await detectMainBranch(workingDir);
          effectiveDir = await createWorktree(updatedTask.task_key, workingDir, mainBranch);
          runState.worktreePath = effectiveDir;
          branchName = `agent/${updatedTask.task_key}`;

          // Store worktree info in DB for crash recovery
          db.query(
            `UPDATE tasks SET agent_worktree = ?, agent_branch = ? WHERE id = ?`
          ).run(effectiveDir, branchName, taskId);
        }

        const recentCommits = await getRecentCommits(workingDir);
        const prompt = buildPrompt(updatedTask, {
          workingDir: effectiveDir,
          branchName,
          mainBranch,
          recentCommits,
        });

        const adapter = new CliAdapter(config);
        const result = await adapter.execute({
          task: updatedTask,
          prompt,
          workingDir: effectiveDir,
          onOutput: (line: string) => {
            queueLog('agent', line);
            broadcastLog('agent', line);
          },
          signal: abortController.signal,
          onPid: (pid: number) => { runState.pid = pid; },
        });

        clearTimeout(timeoutTimer);

        if (flushTimer) clearTimeout(flushTimer);
        flushLogBuffer();

        if (lostLogCount > 0) {
          const warnMsg = `${lostLogCount} log lines were lost due to storage error.`;
          try { insertLogStmt.run(taskId, runNumber, 'warn', warnMsg); } catch {}
          broadcastLog('warn', warnMsg);
        }

        handleAgentResult(result, task, updatedTask, taskId, db, insertLogStmt, runNumber, broadcastLog);
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
            broadcaster.broadcast('agent:status', { taskId, taskKey: task.task_key, status: 'failed' });
            broadcaster.broadcast('toast', {
              type: 'error',
              message: `${task.task_key} failed: ${message}`,
            });
          }
        } catch {
          // DB may have been closed during shutdown
        }
      } finally {
        // Check for uncommitted changes before cleanup
        if (useWorktree && runState.worktreePath) {
          try {
            const warning = await checkUncommittedChanges(updatedTask.task_key, workingDir);
            if (warning) {
              try { insertLogStmt.run(taskId, runNumber, 'warn', warning); } catch {}
              broadcastLog('warn', warning);
            }
          } catch {}

          try {
            await removeWorktree(updatedTask.task_key, workingDir);
          } catch {}

          try {
            db.query(
              `UPDATE tasks SET agent_worktree = NULL, agent_branch = NULL WHERE id = ?`
            ).run(taskId);
          } catch {}
        }

        activeRuns.delete(taskId);
        runState.resolveCompletion();
      }
    };

    // Fire and forget
    executeAgent();

    return updatedTask;
  } catch (err: any) {
    // If we fail before executeAgent fires, clean up
    if (activeRuns.get(taskId) === runState) {
      if (originalTask) {
        try {
          db.query(
            `UPDATE tasks SET status = ?, agent_status = ?, sort_order = ?, agent_worktree = NULL, agent_branch = NULL WHERE id = ?`
          ).run(originalTask.status, originalTask.agent_status, originalTask.sort_order, taskId);
          broadcaster.broadcast('task:updated', { task: originalTask });
        } catch {
          // Best effort rollback
        }
      }

      activeRuns.delete(taskId);
      runState.resolveCompletion();
    }
    throw err;
  }
}

function handleAgentResult(
  result: { success: boolean; summary: string },
  originalTask: Task,
  updatedTask: Task,
  taskId: number,
  db: ReturnType<typeof getDb>,
  insertLogStmt: any,
  runNumber: number,
  broadcastLog: (level: string, message: string) => void,
): void {
  if (result.success) {
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
    broadcaster.broadcast('agent:status', { taskId, taskKey: originalTask.task_key, status: 'completed' });
    broadcaster.broadcast('toast', {
      type: 'success',
      message: `${originalTask.task_key} completed successfully.`,
    });
  } else {
    db.query(
      `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
    ).run(taskId);

    const finalTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;
    broadcaster.broadcast('task:updated', { task: finalTask });
    broadcaster.broadcast('agent:status', { taskId, taskKey: originalTask.task_key, status: 'failed' });
    broadcaster.broadcast('toast', {
      type: 'error',
      message: `${originalTask.task_key} failed: ${result.summary}`,
    });
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

  const runState = activeRuns.get(taskId);
  if (!runState) {
    throw Object.assign(new Error('No agent running on this task'), { status: 400 });
  }

  const isCanceller = !runState.cancelling;
  if (isCanceller) {
    runState.cancelling = true;
    runState.abortController.abort();
  }

  await runState.completionPromise;

  // Re-read task after the executor has finished
  const postTask = db.query<Task, [number]>('SELECT * FROM tasks WHERE id = ?').get(taskId)!;

  if (!isCanceller || postTask.agent_status === 'completed') {
    return postTask;
  }

  // Ensure status is set
  db.query(
    `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ?`
  ).run(taskId);

  const runNumber = runState.runNumber
    || db.query<{ max_run: number | null }, [number]>(
      `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
    ).get(taskId)?.max_run
    || 1;

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
  broadcaster.broadcast('agent:status', { taskId, taskKey: task.task_key, status: 'failed' });
  broadcaster.broadcast('toast', {
    type: 'info',
    message: `${task.task_key} cancelled.`,
  });

  return updatedTask;
}

export async function shutdownAllAgents(): Promise<void> {
  const db = getDb();
  const runs = [...activeRuns.values()];

  for (const run of runs) {
    try {
      // Only update tasks that haven't already completed
      const result = db.query(
        `UPDATE tasks SET agent_status = 'failed' WHERE id = ? AND agent_status != 'completed'`
      ).run(run.taskId);

      // Only write shutdown log if we actually changed the status
      if (result.changes > 0) {
        // Use the actual run number from DB if the executor hasn't set it yet
        const runNumber = run.runNumber || db.query<{ max_run: number | null }, [number]>(
          `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
        ).get(run.taskId)?.max_run || 1;

        try {
          db.query(
            `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'error', 'Server shutting down — agent run aborted.')`
          ).run(run.taskId, runNumber);
        } catch {}
      }
    } catch {}

    run.abortController.abort();
  }

  // Wait for all completion promises
  await Promise.allSettled(runs.map(r => r.completionPromise));
}
