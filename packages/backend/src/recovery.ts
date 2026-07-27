import { getDb } from './db/database.js';
import { getProcessStartTime, isProcessAlive } from './process-utils.js';
import { recoverInterruptedRuns } from './flow/engine.js';

function terminateOwnedProcess(pid: number, startedAt: string | null): void {
  if (!Number.isInteger(pid) || pid <= 1 || !isProcessAlive(pid) || !startedAt) return;
  const actual = getProcessStartTime(pid);
  if (!actual || Math.abs(new Date(actual).getTime() - new Date(startedAt).getTime()) >= 2000) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
}

export function runCrashRecovery(): number {
  const db = getDb();
  const running = db.query<{ pid: number | null; process_started_at: string | null }, []>(
    "SELECT pid, process_started_at FROM attempts WHERE status = 'running'"
  ).all();
  for (const attempt of running) if (attempt.pid) terminateOwnedProcess(attempt.pid, attempt.process_started_at);
  const count = recoverInterruptedRuns();
  if (count) console.log(`Crash recovery: marked ${count} interrupted execution${count === 1 ? '' : 's'} for attention.`);
  return count;
}
