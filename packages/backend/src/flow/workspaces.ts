import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../db/database.js';
import type { Task, Workspace } from '../types.js';
import { createWorktree, detectMainBranch, isGitRepo } from '../worktree/worktree.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

export async function ensureWorkspace(task: Task, repoRoot: string): Promise<Workspace> {
  const db = getDb();
  const existing = db.query<Workspace, [number]>(
    "SELECT * FROM workspaces WHERE task_id = ? AND state IN ('active', 'retained', 'cleanup_required') ORDER BY id DESC LIMIT 1"
  ).get(task.id);
  if (existing && fs.existsSync(existing.worktree_path)) {
    if (existing.state !== 'active') db.query("UPDATE workspaces SET state = 'active' WHERE id = ?").run(existing.id);
    return { ...existing, state: 'active' };
  }

  const gitRepo = isGitRepo(repoRoot);
  const worktreePath = gitRepo
    ? await createWorktree(task.task_key, repoRoot, await detectMainBranch(repoRoot))
    : repoRoot;
  const branch = gitRepo ? `agent/${task.task_key}` : null;
  const result = db.query(
    `INSERT INTO workspaces (task_id, repo_root, worktree_path, branch, state)
     VALUES (?, ?, ?, ?, 'active')`
  ).run(task.id, repoRoot, worktreePath, branch);
  return db.query<Workspace, [number]>('SELECT * FROM workspaces WHERE id = ?').get(Number(result.lastInsertRowid))!;
}

export async function inspectWorkspace(workspace: Workspace): Promise<{ dirty: boolean; summary: string }> {
  if (workspace.worktree_path === workspace.repo_root || !isGitRepo(workspace.repo_root)) {
    return { dirty: false, summary: 'The project is not using an isolated Git worktree.' };
  }
  try {
    const output = await git(['status', '--porcelain'], workspace.worktree_path);
    const files = output.trim() ? output.trim().split('\n') : [];
    return { dirty: files.length > 0, summary: files.length ? `${files.length} changed file${files.length === 1 ? '' : 's'}` : 'Workspace is clean.' };
  } catch (error) {
    return { dirty: true, summary: `Could not inspect workspace: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function finalizeWorkspace(workspaceId: number, completed: boolean): Promise<void> {
  const db = getDb();
  const workspace = db.query<Workspace, [number]>('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!workspace) return;
  if (!completed) {
    db.query("UPDATE workspaces SET state = 'retained' WHERE id = ?").run(workspace.id);
    return;
  }
  const inspection = await inspectWorkspace(workspace);
  if (inspection.dirty) {
    db.query("UPDATE workspaces SET state = 'cleanup_required', is_dirty = 1 WHERE id = ?").run(workspace.id);
    return;
  }
  if (workspace.worktree_path !== workspace.repo_root && fs.existsSync(workspace.worktree_path)) {
    try {
      await git(['worktree', 'remove', workspace.worktree_path], workspace.repo_root);
    } catch {
      db.query("UPDATE workspaces SET state = 'cleanup_required', is_dirty = 0 WHERE id = ?").run(workspace.id);
      return;
    }
  }
  db.query("UPDATE workspaces SET state = 'removed', is_dirty = 0 WHERE id = ?").run(workspace.id);
}

export async function cleanupWorkspace(workspaceId: number, force = false): Promise<void> {
  const db = getDb();
  const workspace = db.query<Workspace, [number]>('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!workspace) throw Object.assign(new Error('Workspace not found'), { status: 404 });
  const inspection = await inspectWorkspace(workspace);
  if (inspection.dirty && !force) {
    throw Object.assign(new Error(`Workspace has uncommitted changes (${inspection.summary}). Confirm force cleanup to remove it.`), { status: 409, reason: 'workspace_dirty' });
  }
  if (workspace.worktree_path !== workspace.repo_root && fs.existsSync(workspace.worktree_path)) {
    await git(['worktree', 'remove', workspace.worktree_path, ...(force ? ['--force'] : [])], workspace.repo_root);
  }
  db.query("UPDATE workspaces SET state = 'removed', is_dirty = ? WHERE id = ?").run(inspection.dirty ? 1 : 0, workspace.id);
}
