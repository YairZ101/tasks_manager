import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

export async function detectMainBranch(repoRoot: string): Promise<string> {
  // Try the remote HEAD symref first
  try {
    const { stdout } = await git(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], repoRoot);
    const branch = stdout.trim().replace(/^origin\//, '');
    if (branch) return branch;
  } catch {}

  // Fall back to checking if common branch names exist
  for (const name of ['main', 'master']) {
    try {
      await git(['rev-parse', '--verify', name], repoRoot);
      return name;
    } catch {}
  }

  // Last resort: whatever HEAD points to
  try {
    const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
    return stdout.trim() || 'main';
  } catch {
    return 'main';
  }
}

export async function createWorktree(taskKey: string, repoRoot: string, mainBranch: string): Promise<string> {
  const worktreePath = path.join(repoRoot, '.tasks_manager', 'worktrees', taskKey);
  const branchName = `agent/${taskKey}`;

  // Reuse existing worktree if it's still valid
  if (fs.existsSync(worktreePath)) {
    try {
      // Verify it's a valid git worktree by checking HEAD
      await git(['rev-parse', '--git-dir'], worktreePath);
      return worktreePath;
    } catch {
      // Worktree directory exists but is broken — remove and recreate
      await git(['worktree', 'remove', worktreePath, '--force'], repoRoot).catch(() => {});
    }
  }

  // Check if the branch already exists
  const branchExists = await git(['rev-parse', '--verify', branchName], repoRoot)
    .then(() => true)
    .catch(() => false);

  if (branchExists) {
    // --force allows the branch to be checked out even if it's
    // already checked out in the main worktree
    await git(['worktree', 'add', '--force', worktreePath, branchName], repoRoot);
  } else {
    await git(['worktree', 'add', worktreePath, '-b', branchName, mainBranch], repoRoot);
  }

  // Initialize submodules if the repo uses them.
  // Check in the worktree itself (not repoRoot) since branches can diverge.
  // Failure is non-fatal — the worktree is already created and usable.
  const gitmodulesPath = path.join(worktreePath, '.gitmodules');
  if (fs.existsSync(gitmodulesPath)) {
    try {
      await git(['submodule', 'update', '--init', '--recursive'], worktreePath);
    } catch {
      // Submodule init failed (network error, etc.) — continue anyway
    }
  }

  return worktreePath;
}

export async function removeWorktree(taskKey: string, repoRoot: string): Promise<void> {
  const worktreePath = path.join(repoRoot, '.tasks_manager', 'worktrees', taskKey);
  await git(['worktree', 'remove', worktreePath, '--force'], repoRoot).catch(() => {});
}

export async function removeBranch(taskKey: string, repoRoot: string): Promise<void> {
  const branchName = `agent/${taskKey}`;
  await git(['branch', '-D', branchName], repoRoot).catch(() => {});
}

export async function checkUncommittedChanges(taskKey: string, repoRoot: string): Promise<string | null> {
  const worktreePath = path.join(repoRoot, '.tasks_manager', 'worktrees', taskKey);

  const { stdout } = await git(['status', '--porcelain'], worktreePath).catch(() => ({ stdout: '' }));
  if (!stdout.trim()) return null;

  const fileCount = stdout.trim().split('\n').length;
  return `Agent left ${fileCount} uncommitted file(s) in the worktree.`;
}

export async function cleanupStaleWorktrees(repoRoot: string): Promise<void> {
  await git(['worktree', 'prune'], repoRoot);
}

export function isGitRepo(dir: string): boolean {
  try {
    const result = Bun.spawnSync({ cmd: ['git', 'rev-parse', '--git-dir'], cwd: dir });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function getRecentCommits(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await git(['log', '--oneline', '-10'], repoRoot);
    return stdout.trim();
  } catch {
    return '';
  }
}
