import fs from 'fs';
import { getDb } from './db/database.js';
import { getProcessStartTime, isProcessAlive } from './process-utils.js';
import type { Task } from './types.js';

function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) return;

  try {
    // Kill entire process group
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already dead
    }
  }

  // Wait up to 5 seconds for process to die
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    Bun.sleepSync(100);
  }

  // Force kill if still alive
  if (isProcessAlive(pid)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }
  }
}

export function runCrashRecovery(): void {
  const db = getDb();
  const repoRoot = process.cwd();

  // Prune stale worktrees unconditionally
  try {
    Bun.spawnSync({ cmd: ['git', 'worktree', 'prune'], cwd: repoRoot });
  } catch {
    // Not a git repo or git not available — fine
  }

  const runningTasks = db
    .query<Task, []>(`SELECT * FROM tasks WHERE agent_status = 'running'`)
    .all();

  for (const task of runningTasks) {
    if (task.agent_pid != null) {
      if (isProcessAlive(task.agent_pid)) {
        const actualStartTime = getProcessStartTime(task.agent_pid);
        if (actualStartTime !== null && task.agent_started_at !== null) {
          const storedTime = new Date(task.agent_started_at).getTime();
          const actualTime = new Date(actualStartTime).getTime();
          const driftMs = Math.abs(storedTime - actualTime);
          if (driftMs < 2000) {
            killProcessTree(task.agent_pid);
          }
        }
      }
    }

    // Clean up worktree if one exists
    if (task.agent_worktree) {
      try {
        if (fs.existsSync(task.agent_worktree)) {
          Bun.spawnSync({ cmd: ['git', 'worktree', 'remove', task.agent_worktree, '--force'], cwd: repoRoot });
        }
      } catch {
        // Worktree cleanup failed — not fatal
      }
    }

    // Mark as failed and clear worktree/branch columns
    db.query(
      `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL,
        agent_worktree = NULL, agent_branch = NULL WHERE id = ?`
    ).run(task.id);

    // Compute run_number for this recovery log
    const runRow = db
      .query<{ max_run: number | null }, [number]>(
        `SELECT MAX(run_number) as max_run FROM task_logs WHERE task_id = ?`
      )
      .get(task.id);
    const runNumber = (runRow?.max_run ?? 0) || 1;

    db.query(
      `INSERT INTO task_logs (task_id, run_number, level, message) VALUES (?, ?, 'error', 'Server restarted — previous agent run was aborted.')`
    ).run(task.id, runNumber);
  }

  if (runningTasks.length > 0) {
    console.log(`Crash recovery: cleaned up ${runningTasks.length} orphaned agent run(s).`);
  }
}
