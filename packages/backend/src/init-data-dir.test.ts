import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDataDir } from './init-data-dir.js';

describe('initDataDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates the .tasks_manager directory', () => {
    initDataDir(tmpDir);
    const dataDir = path.join(tmpDir, '.tasks_manager');
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.statSync(dataDir).isDirectory()).toBe(true);
  });

  test('creates a .gitignore inside the data directory', () => {
    initDataDir(tmpDir);
    const gitignorePath = path.join(tmpDir, '.tasks_manager', '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, 'utf-8')).toBe('*\n');
  });

  test('does not overwrite an existing .gitignore', () => {
    const dataDir = path.join(tmpDir, '.tasks_manager');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, '.gitignore'), 'custom\n');

    initDataDir(tmpDir);

    expect(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf-8')).toBe('custom\n');
  });

  test('is idempotent across multiple calls', () => {
    initDataDir(tmpDir);
    initDataDir(tmpDir);

    const gitignorePath = path.join(tmpDir, '.tasks_manager', '.gitignore');
    expect(fs.readFileSync(gitignorePath, 'utf-8')).toBe('*\n');
  });

  test('returns the data directory path', () => {
    const result = initDataDir(tmpDir);
    expect(result).toBe(path.join(tmpDir, '.tasks_manager'));
  });

  test('does not modify the root .gitignore', () => {
    const rootGitignore = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(rootGitignore, 'node_modules/\n');

    initDataDir(tmpDir);

    expect(fs.readFileSync(rootGitignore, 'utf-8')).toBe('node_modules/\n');
  });
});
