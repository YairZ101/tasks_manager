import { describe, test, expect, beforeEach } from 'bun:test';
import { SSEBroadcaster } from './broadcaster.js';

describe('SSEBroadcaster', () => {
  let broadcaster: SSEBroadcaster;

  beforeEach(() => {
    broadcaster = new SSEBroadcaster();
  });

  test('starts with zero clients', () => {
    expect(broadcaster.clientCount).toBe(0);
  });

  test('broadcast does not throw with no clients', () => {
    broadcaster.broadcast('task:updated', { id: 1 });
    broadcaster.broadcast('task:updated', { id: 2 });
    expect(broadcaster.clientCount).toBe(0);
  });

  test('connect creates a valid SSE Response', () => {
    const mockContext = {
      req: {
        header: () => undefined,
        raw: { signal: new AbortController().signal },
      },
    } as any;

    const response = broadcaster.connect(mockContext);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(broadcaster.clientCount).toBe(1);
  });

  test('connect with Last-Event-ID replays missed events', () => {
    broadcaster.broadcast('task:updated', { id: 1 });
    broadcaster.broadcast('task:updated', { id: 2 });
    broadcaster.broadcast('task:updated', { id: 3 });

    const mockContext = {
      req: {
        header: () => undefined,
        raw: { signal: new AbortController().signal },
      },
    } as any;

    const response = broadcaster.connect(mockContext, '1');
    expect(response).toBeInstanceOf(Response);
    expect(broadcaster.clientCount).toBe(1);
  });

  test('connect with stale Last-Event-ID sends stale event', () => {
    for (let i = 0; i < 1001; i++) {
      broadcaster.broadcast('test', { i });
    }

    const mockContext = {
      req: {
        header: () => undefined,
        raw: { signal: new AbortController().signal },
      },
    } as any;

    const response = broadcaster.connect(mockContext, '1');
    expect(response).toBeInstanceOf(Response);
  });

  test('stop clears all clients', () => {
    const mockContext = {
      req: {
        header: () => undefined,
        raw: { signal: new AbortController().signal },
      },
    } as any;

    broadcaster.connect(mockContext);
    broadcaster.connect(mockContext);
    expect(broadcaster.clientCount).toBe(2);

    broadcaster.stop();
    expect(broadcaster.clientCount).toBe(0);
  });

  test('start and stop heartbeat timer without error', () => {
    broadcaster.start();
    broadcaster.stop();
  });

  test('broadcast to multiple clients does not throw', () => {
    const mockContext = {
      req: {
        header: () => undefined,
        raw: { signal: new AbortController().signal },
      },
    } as any;

    broadcaster.connect(mockContext);
    broadcaster.connect(mockContext);
    expect(broadcaster.clientCount).toBe(2);

    broadcaster.broadcast('task:updated', { task: { id: 1 } });
    broadcaster.broadcast('agent:status', { taskId: 1, status: 'running' });
    broadcaster.stop();
  });

  test('client disconnect via abort signal removes client', async () => {
    const abortController = new AbortController();
    const mockContext = {
      req: {
        header: () => undefined,
        raw: { signal: abortController.signal },
      },
    } as any;

    broadcaster.connect(mockContext);
    expect(broadcaster.clientCount).toBe(1);

    abortController.abort();
    // Give the event listener a tick to fire
    await new Promise((r) => setTimeout(r, 10));
    expect(broadcaster.clientCount).toBe(0);
  });
});
