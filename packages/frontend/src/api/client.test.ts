import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './client.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('API client', () => {
  test('encodes work-view filters', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await api.listTasks({ q: 'graph plan', state: 'attention' });
    expect(fetch).toHaveBeenCalledWith('/tasks?q=graph+plan&state=attention', expect.anything());
  });
  test('preserves structured error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Dirty workspace', reason: 'workspace_dirty' }), { status: 409 })));
    await expect(api.deleteTask(2)).rejects.toMatchObject({ message: 'Dirty workspace', status: 409, data: { reason: 'workspace_dirty' } });
  });
  test('fails a request that never receives a response', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_path: string, options: RequestInit) => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const status = expect(api.status()).rejects.toThrow('The server did not respond. Check that Flow is running and try again.');
    await vi.advanceTimersByTimeAsync(10_000);
    await status;
  });
  test('sends a proposed Agent setup to the test endpoint without saving it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, durationMs: 10, output: 'OK' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await api.testAgentConfig({ cli_cmd: 'agent run', cli_prompt_mode: 'stdin', cli_prompt_flag: '' });
    expect(fetch).toHaveBeenCalledWith('/agent-config/test', expect.objectContaining({ method: 'POST', body: JSON.stringify({ cli_cmd: 'agent run', cli_prompt_mode: 'stdin', cli_prompt_flag: '' }) }));
  });
  test('reads live Agent-test output from the event stream', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('event: output\ndata: {"line":"OK"}\n\nevent: complete\ndata: {"success":true,"durationMs":10}\n\n')); controller.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const lines: string[] = [];
    await expect(api.testAgentConfigStream({ cli_cmd: 'agent run', cli_prompt_mode: 'stdin' }, (line) => lines.push(line))).resolves.toMatchObject({ success: true, durationMs: 10 });
    expect(lines).toEqual(['OK']);
  });
});
