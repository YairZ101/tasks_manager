import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, initDb } from '../db/database.js';
import { emitEvent } from '../flow/events.js';
import { SSEBroadcaster, broadcaster } from './broadcaster.js';

let root = '';
afterEach(() => { broadcaster.stop(); closeDb(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

function context(last?: string): any {
  const controller = new AbortController();
  return { req: { raw: { signal: controller.signal }, header: () => last } };
}

describe('persisted SSE broadcaster', () => {
  test('broadcasts events using their database ID', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-sse-'));
    initDb(root);
    const response = broadcaster.connect(context());
    const reader = response.body!.getReader();
    const pending = reader.read();
    const id = emitEvent('task:changed', { taskId: 4 });
    const chunk = new TextDecoder().decode((await pending).value);
    expect(chunk).toContain(`id: ${id}`);
    expect(chunk).toContain('event: task:changed');
    await reader.cancel();
  });

  test('starts and stops without clients', () => {
    const instance = new SSEBroadcaster();
    instance.start();
    expect(instance.clientCount).toBe(0);
    instance.stop();
  });
});
