import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ApiAdapter } from './api-adapter.js';
import type { AgentConfig, Task } from '../types.js';

const makeConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 1,
  type: 'api',
  cli_cmd: null,
  cli_prompt_mode: 'stdin',
  cli_prompt_flag: null,
  api_url: 'http://localhost:9999/v1/chat/completions',
  api_headers: null,
  api_model: 'test-model',
  api_request_format: 'openai',
  api_stream_format: 'none',
  timeout_ms: 30000,
  updated_at: '',
  ...overrides,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  task_key: 'TST-1',
  title: 'Test Task',
  description: '',
  acceptance: '',
  status: 'in-progress',
  agent_status: 'running',
  agent_pid: null,
  agent_started_at: null,
  sort_order: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides,
});

const originalFetch = globalThis.fetch;

describe('ApiAdapter', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('throws when api_url is not configured', async () => {
    const adapter = new ApiAdapter(makeConfig({ api_url: null }));
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: '/tmp',
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('API URL not configured');
  });

  test('throws on non-OK HTTP response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal error', { status: 500 }))
    ) as any;

    const adapter = new ApiAdapter(makeConfig());
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: '/tmp',
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('API returned 500');
  });

  test('throws on invalid API headers JSON', async () => {
    const adapter = new ApiAdapter(makeConfig({ api_headers: 'not-json' }));
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: '/tmp',
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('Invalid API headers JSON');
  });

  test('non-streaming openai format parses response correctly', async () => {
    const apiResponse = {
      choices: [{ message: { content: 'Hello from API\nLine 2' } }],
    };
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(apiResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    ) as any;

    const adapter = new ApiAdapter(makeConfig({ api_stream_format: 'none' }));
    const controller = new AbortController();
    const output: string[] = [];

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: '/tmp',
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(output).toEqual(['Hello from API', 'Line 2']);
  });

  test('non-streaming ollama format parses response correctly', async () => {
    const apiResponse = { response: 'Ollama says hi' };
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(apiResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    ) as any;

    const adapter = new ApiAdapter(
      makeConfig({ api_request_format: 'ollama', api_stream_format: 'none' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: '/tmp',
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(output).toEqual(['Ollama says hi']);
  });

  test('sends correct openai request body', async () => {
    let capturedBody: any;
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
        })
      );
    }) as any;

    const adapter = new ApiAdapter(makeConfig({ api_model: 'gpt-4', api_stream_format: 'none' }));
    const controller = new AbortController();

    await adapter.execute({
      task: makeTask(),
      prompt: 'my prompt',
      workingDir: '/tmp',
      onOutput: () => {},
      signal: controller.signal,
    });

    expect(capturedBody.model).toBe('gpt-4');
    expect(capturedBody.messages).toEqual([{ role: 'user', content: 'my prompt' }]);
    expect(capturedBody.stream).toBe(false);
  });

  test('sends correct ollama request body', async () => {
    let capturedBody: any;
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ response: 'ok' }), { status: 200 })
      );
    }) as any;

    const adapter = new ApiAdapter(
      makeConfig({ api_request_format: 'ollama', api_model: 'llama3', api_stream_format: 'none' })
    );
    const controller = new AbortController();

    await adapter.execute({
      task: makeTask(),
      prompt: 'my prompt',
      workingDir: '/tmp',
      onOutput: () => {},
      signal: controller.signal,
    });

    expect(capturedBody.model).toBe('llama3');
    expect(capturedBody.prompt).toBe('my prompt');
    expect(capturedBody.stream).toBe(false);
  });

  test('includes custom headers', async () => {
    let capturedHeaders: any;
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedHeaders = init.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
        })
      );
    }) as any;

    const adapter = new ApiAdapter(
      makeConfig({
        api_headers: JSON.stringify({ Authorization: 'Bearer token123' }),
        api_stream_format: 'none',
      })
    );
    const controller = new AbortController();

    await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: '/tmp',
      onOutput: () => {},
      signal: controller.signal,
    });

    expect(capturedHeaders['Authorization']).toBe('Bearer token123');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });

  test('SSE streaming parses delta content', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"World"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(sseData, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    ) as any;

    const adapter = new ApiAdapter(makeConfig({ api_stream_format: 'sse' }));
    const controller = new AbortController();
    const output: string[] = [];

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: '/tmp',
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(output).toContain('Hello ');
    expect(output).toContain('World');
  });

  test('NDJSON streaming parses responses', async () => {
    const ndjson = [
      '{"response":"Hello "}',
      '{"response":"World"}',
      '',
    ].join('\n');

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(ndjson, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      )
    ) as any;

    const adapter = new ApiAdapter(
      makeConfig({ api_request_format: 'ollama', api_stream_format: 'ndjson' })
    );
    const controller = new AbortController();
    const output: string[] = [];

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: '/tmp',
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(output).toContain('Hello ');
    expect(output).toContain('World');
  });

  test('handles non-JSON response in non-streaming mode', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('plain text response', { status: 200 }))
    ) as any;

    const adapter = new ApiAdapter(makeConfig({ api_stream_format: 'none' }));
    const controller = new AbortController();
    const output: string[] = [];

    const result = await adapter.execute({
      task: makeTask(),
      prompt: 'test',
      workingDir: '/tmp',
      onOutput: (line) => output.push(line),
      signal: controller.signal,
    });

    expect(result.success).toBe(true);
    expect(output).toEqual(['plain text response']);
  });

  test('throws on network error (fetch rejects)', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError('Failed to fetch'))
    ) as any;

    const adapter = new ApiAdapter(makeConfig({ api_stream_format: 'none' }));
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: '/tmp',
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('Failed to fetch');
  });

  test('handles empty api_url string', async () => {
    const adapter = new ApiAdapter(makeConfig({ api_url: '' }));
    const controller = new AbortController();

    await expect(
      adapter.execute({
        task: makeTask(),
        prompt: 'test',
        workingDir: '/tmp',
        onOutput: () => {},
        signal: controller.signal,
      })
    ).rejects.toThrow('API URL not configured');
  });
});
