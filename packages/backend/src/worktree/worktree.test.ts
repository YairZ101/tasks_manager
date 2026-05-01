import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  detectMainBranch,
  createWorktree,
  removeWorktree,
  checkUncommittedChanges,
  cleanupStaleWorktrees,
  isGitRepo,
  getRecentCommits,
} from './worktree.js';

function gitSync(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function initTestRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wt-'));
  gitSync(['init', '--initial-branch', 'main'], tmpDir);
  gitSync(['config', 'user.email', 'test@test.com'], tmpDir);
  gitSync(['config', 'user.name', 'Test'], tmpDir);
  // Need at least one commit for worktree operations
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test\n');
  gitSync(['add', '.'], tmpDir);
  gitSync(['commit', '-m', 'initial commit'], tmpDir);
  // Create .tasks_manager directory
  fs.mkdirSync(path.join(tmpDir, '.tasks_manager'), { recursive: true });
  return tmpDir;
}

describe('isGitRepo', () => {
  test('returns true for a git repository', () => {
    const tmpDir = initTestRepo();
    try {
      expect(isGitRepo(tmpDir)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns false for a non-git directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wt-'));
    try {
      expect(isGitRepo(tmpDir)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('detectMainBranch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initTestRepo();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects "main" as the main branch', async () => {
    const branch = await detectMainBranch(tmpDir);
    expect(branch).toBe('main');
  });

  test('detects "master" when main does not exist', async () => {
    // Rename main to master
    gitSync(['branch', '-m', 'main', 'master'], tmpDir);
    const branch = await detectMainBranch(tmpDir);
    expect(branch).toBe('master');
  });

  test('falls back to HEAD when no common branch names exist', async () => {
    gitSync(['branch', '-m', 'main', 'develop'], tmpDir);
    const branch = await detectMainBranch(tmpDir);
    expect(branch).toBe('develop');
  });
});

describe('getRecentCommits', () => {
  test('returns commit log lines', async () => {
    const tmpDir = initTestRepo();
    try {
      const commits = await getRecentCommits(tmpDir);
      expect(commits).toContain('initial commit');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns empty string for non-git directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-wt-'));
    try {
      const commits = await getRecentCommits(tmpDir);
      expect(commits).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('createWorktree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initTestRepo();
  });

  afterEach(() => {
    // Clean up worktrees before removing the repo
    try { gitSync(['worktree', 'prune'], tmpDir); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates a worktree at the expected path', async () => {
    const wtPath = await createWorktree('TST-1', tmpDir, 'main');

    expect(wtPath).toBe(path.join(tmpDir, '.tasks_manager', 'worktrees', 'TST-1'));
    expect(fs.existsSync(wtPath)).toBe(true);
    // The worktree should have the repo's files
    expect(fs.existsSync(path.join(wtPath, 'README.md'))).toBe(true);
  });

  test('creates the agent branch', async () => {
    await createWorktree('TST-1', tmpDir, 'main');

    const branches = gitSync(['branch', '--list', 'agent/TST-1'], tmpDir);
    expect(branches).toContain('agent/TST-1');
  });

  test('worktree is on the correct branch', async () => {
    const wtPath = await createWorktree('TST-1', tmpDir, 'main');

    const branch = gitSync(['rev-parse', '--abbrev-ref', 'HEAD'], wtPath);
    expect(branch).toBe('agent/TST-1');
  });

  test('cleans up stale worktree and branch from previous run', async () => {
    // Create and remove a worktree, leaving the branch
    const wtPath1 = await createWorktree('TST-1', tmpDir, 'main');
    await removeWorktree('TST-1', tmpDir);

    // Second creation should succeed
    const wtPath2 = await createWorktree('TST-1', tmpDir, 'main');
    expect(fs.existsSync(wtPath2)).toBe(true);
  });

  test('preserves branch with unmerged commits by renaming', async () => {
    const wtPath = await createWorktree('TST-1', tmpDir, 'main');

    // Make a commit on the agent branch
    fs.writeFileSync(path.join(wtPath, 'new-file.txt'), 'agent work\n');
    gitSync(['add', '.'], wtPath);
    gitSync(['commit', '-m', 'agent commit'], wtPath);

    await removeWorktree('TST-1', tmpDir);

    // Now create again — the old branch should be renamed, not deleted
    await createWorktree('TST-1', tmpDir, 'main');

    const branches = gitSync(['branch'], tmpDir);
    expect(branches).toContain('agent/TST-1-prev-');
  });

  test('deletes branch with no unmerged commits on recreation', async () => {
    await createWorktree('TST-1', tmpDir, 'main');
    // No commits made on the branch
    await removeWorktree('TST-1', tmpDir);

    await createWorktree('TST-1', tmpDir, 'main');

    const branches = gitSync(['branch'], tmpDir);
    expect(branches).not.toContain('prev');
  });
});

describe('removeWorktree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initTestRepo();
  });

  afterEach(() => {
    try { gitSync(['worktree', 'prune'], tmpDir); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes an existing worktree', async () => {
    const wtPath = await createWorktree('TST-1', tmpDir, 'main');
    expect(fs.existsSync(wtPath)).toBe(true);

    await removeWorktree('TST-1', tmpDir);
    expect(fs.existsSync(wtPath)).toBe(false);
  });

  test('does not throw when worktree does not exist', async () => {
    await removeWorktree('NONEXISTENT-99', tmpDir);
    // Should not throw
  });

  test('keeps the agent branch after removal', async () => {
    await createWorktree('TST-1', tmpDir, 'main');
    await removeWorktree('TST-1', tmpDir);

    const branches = gitSync(['branch', '--list', 'agent/TST-1'], tmpDir);
    expect(branches).toContain('agent/TST-1');
  });
});

describe('checkUncommittedChanges', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = initTestRepo();
  });

  afterEach(() => {
    try { gitSync(['worktree', 'prune'], tmpDir); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns null for a clean worktree', async () => {
    await createWorktree('TST-1', tmpDir, 'main');

    const result = await checkUncommittedChanges('TST-1', tmpDir);
    expect(result).toBeNull();
  });

  test('returns warning with file count for dirty worktree', async () => {
    const wtPath = await createWorktree('TST-1', tmpDir, 'main');

    fs.writeFileSync(path.join(wtPath, 'uncommitted.txt'), 'dirty\n');
    fs.writeFileSync(path.join(wtPath, 'another.txt'), 'also dirty\n');

    const result = await checkUncommittedChanges('TST-1', tmpDir);
    expect(result).not.toBeNull();
    expect(result).toContain('2 uncommitted file(s)');
  });

  test('returns null for nonexistent worktree', async () => {
    const result = await checkUncommittedChanges('NONEXISTENT', tmpDir);
    expect(result).toBeNull();
  });
});

describe('cleanupStaleWorktrees', () => {
  test('prunes without error on a git repo', async () => {
    const tmpDir = initTestRepo();
    try {
      await cleanupStaleWorktrees(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
