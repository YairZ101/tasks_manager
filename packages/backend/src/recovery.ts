import { getDb } from './db/database.js';
import { execSync } from 'child_process';
import fs from 'fs';
import type { Task } from './types.js';

function getProcessStartTime(pid: number): string | null {
  try {
    if (process.platform === 'darwin') {
      const output = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8' }).trim();
      return output || null;
    } else {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const fields = stat.split(' ');
      return fields[21] || null;
    }
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid: number): void {
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

    // Mark as failed
    db.exec(
      `UPDATE tasks SET agent_status = 'failed', agent_pid = NULL, agent_started_at = NULL WHERE id = ${task.id}`
    );

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
