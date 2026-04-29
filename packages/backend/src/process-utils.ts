import { execFileSync } from 'child_process';

export function getProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf-8' }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
