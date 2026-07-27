import fs from 'fs';
import path from 'path';
import { getProcessStartTime, isProcessAlive } from './process-utils.js';

const DATA_DIR = '.flow';
const LOCK_FILE = '.lock';

interface LockData {
  pid: number;
  startedAt: string;
}

function isMatchingLiveProcess(lock: LockData): boolean {
  if (!Number.isInteger(lock.pid) || lock.pid <= 1 || !isProcessAlive(lock.pid)) return false;
  const actualStartTime = getProcessStartTime(lock.pid);
  if (actualStartTime === null) return false;
  return Math.abs(new Date(lock.startedAt).getTime() - new Date(actualStartTime).getTime()) < 2000;
}

export function acquireLock(repoRoot: string): void {
  const lockPath = path.join(repoRoot, DATA_DIR, LOCK_FILE);

  // Bun's watch mode can start the replacement process just before the old
  // process finishes its graceful shutdown. Give that owner a short window to
  // release the lock, while still rejecting a genuinely concurrent server.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as LockData;
      if (lock.pid === process.pid || !isMatchingLiveProcess(lock)) break;
      if (attempt < 9) {
        Bun.sleepSync(50);
        continue;
      }
      console.error(`Another instance of Flow is already running in this directory (PID: ${lock.pid}).`);
      process.exit(1);
    } catch {
      break;
    }
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
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as LockData;
    if (lock.pid !== process.pid) return;
    fs.unlinkSync(lockPath);
  } catch {
    // Already removed
  }
}
