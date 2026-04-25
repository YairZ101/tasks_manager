import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DATA_DIR = '.tasks_manager';
const LOCK_FILE = '.lock';

interface LockData {
  pid: number;
  startedAt: string;
}

function getProcessStartTime(pid: number): string | null {
  try {
    if (process.platform === 'darwin') {
      const output = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8' }).trim();
      return output || null;
    } else {
      // Linux: read /proc/<pid>/stat field 22
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

export function acquireLock(repoRoot: string): void {
  const lockPath = path.join(repoRoot, DATA_DIR, LOCK_FILE);

  // Read existing lock
  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    const lock: LockData = JSON.parse(content);

    if (isProcessAlive(lock.pid)) {
      // Check if it's really the same process (PID reuse detection)
      const actualStartTime = getProcessStartTime(lock.pid);
      if (actualStartTime !== null) {
        // Process is alive — refuse to start
        console.error(
          `Another instance of tasks-manager is already running in this directory (PID: ${lock.pid}).`
        );
        process.exit(1);
      }
      // Can't determine start time — assume PID reused, overwrite
    }
  } catch {
    // No lock file or invalid JSON — proceed
  }

  // Write our lock
  const lockData: LockData = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(lockPath, JSON.stringify(lockData), 'utf-8');
}

export function releaseLock(repoRoot: string): void {
  const lockPath = path.join(repoRoot, DATA_DIR, LOCK_FILE);
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already removed
  }
}
