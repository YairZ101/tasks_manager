import fs from 'fs';
import path from 'path';
import { getProcessStartTime, isProcessAlive } from './process-utils.js';

const DATA_DIR = '.tasks_manager';
const LOCK_FILE = '.lock';

interface LockData {
  pid: number;
  startedAt: string;
}

export function acquireLock(repoRoot: string): void {
  const lockPath = path.join(repoRoot, DATA_DIR, LOCK_FILE);

  // Read existing lock
  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    const lock: LockData = JSON.parse(content);

    if (isProcessAlive(lock.pid)) {
      const actualStartTime = getProcessStartTime(lock.pid);
      if (actualStartTime !== null) {
        const storedTime = new Date(lock.startedAt).getTime();
        const actualTime = new Date(actualStartTime).getTime();
        const driftMs = Math.abs(storedTime - actualTime);
        if (driftMs < 2000) {
          console.error(
            `Another instance of tasks-manager is already running in this directory (PID: ${lock.pid}).`
          );
          process.exit(1);
        }
      }
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
