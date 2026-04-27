import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { acquireLock, releaseLock } from './lock.js';

const DATA_DIR = '.tasks_manager';

describe('acquireLock / releaseLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-lock-'));
    fs.mkdirSync(path.join(tmpDir, DATA_DIR), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('acquireLock creates a lock file', () => {
    acquireLock(tmpDir);
    const lockPath = path.join(tmpDir, DATA_DIR, '.lock');
    expect(fs.existsSync(lockPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(content.pid).toBe(process.pid);
    expect(content.startedAt).toBeDefined();
  });

  test('releaseLock removes the lock file', () => {
    acquireLock(tmpDir);
    const lockPath = path.join(tmpDir, DATA_DIR, '.lock');
    expect(fs.existsSync(lockPath)).toBe(true);

    releaseLock(tmpDir);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('releaseLock is safe when no lock exists', () => {
    expect(() => releaseLock(tmpDir)).not.toThrow();
  });

  test('acquireLock overwrites stale lock from dead process', () => {
    const lockPath = path.join(tmpDir, DATA_DIR, '.lock');
    const staleLock = { pid: 99999999, startedAt: new Date().toISOString() };
    fs.writeFileSync(lockPath, JSON.stringify(staleLock), 'utf-8');

    acquireLock(tmpDir);

    const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(content.pid).toBe(process.pid);
  });

  test('acquireLock overwrites invalid JSON lock file', () => {
    const lockPath = path.join(tmpDir, DATA_DIR, '.lock');
    fs.writeFileSync(lockPath, 'not valid json', 'utf-8');

    acquireLock(tmpDir);

    const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(content.pid).toBe(process.pid);
  });
});
