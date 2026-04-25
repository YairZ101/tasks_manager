import type { AgentAdapter, AgentConfig, AgentResult, Task } from '../types.js';

export class ApiAdapter implements AgentAdapter {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async execute(params: {
    task: Task & { _prompt?: string };
    workingDir: string;
    onOutput: (line: string) => void;
    signal: AbortSignal;
  }): Promise<AgentResult> {
    const { task, onOutput, signal } = params;
    const prompt = (task as any)._prompt || task.title;

    if (!this.config.api_url) {
      throw new Error('API URL not configured');
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.api_headers) {
      try {
        const customHeaders = JSON.parse(this.config.api_headers);
        Object.assign(headers, customHeaders);
      } catch {
        throw new Error('Invalid API headers JSON');
      }
    }

    // Build request body
    let body: string;
    const shouldStream = this.config.api_stream_format !== 'none';

    if (this.config.api_request_format === 'ollama') {
      body = JSON.stringify({
        model: this.config.api_model || '',
        prompt,
        stream: shouldStream,
      });
    } else {
      body = JSON.stringify({
        model: this.config.api_model || '',
        messages: [{ role: 'user', content: prompt }],
        stream: shouldStream,
      });
    }

    const response = await fetch(this.config.api_url, {
      method: 'POST',
      headers,
      body,
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API returned ${response.status}: ${text.substring(0, 500)}`);
    }

    let lastLine = '';

    if (this.config.api_stream_format === 'none') {
      // Non-streaming: read entire response
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        const content =
          this.config.api_request_format === 'ollama'
            ? json.response || ''
            : json.choices?.[0]?.message?.content || '';
        if (content) {
          for (const line of content.split('\n')) {
            onOutput(line);
            lastLine = line;
          }
        }
      } catch {
        onOutput(text);
        lastLine = text;
      }
    } else if (this.config.api_stream_format === 'sse') {
      await this.parseSSEStream(response, onOutput, (line) => {
        lastLine = line;
      });
    } else if (this.config.api_stream_format === 'ndjson') {
      await this.parseNDJSONStream(response, onOutput, (line) => {
        lastLine = line;
      });
    }

    return {
      success: true,
      summary: lastLine.substring(0, 500),
    };
  }

  private async parseSSEStream(
    response: Response,
    onOutput: (line: string) => void,
    onLastLine: (line: string) => void
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        for (const line of event.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              const content =
                json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
              if (content) {
                onOutput(content);
                onLastLine(content);
              }
            } catch {
              if (data) {
                onOutput(data);
                onLastLine(data);
              }
            }
          }
        }
      }
    }
  }

  private async parseNDJSONStream(
    response: Response,
    onOutput: (line: string) => void,
    onLastLine: (line: string) => void
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          const content = json.response || json.choices?.[0]?.delta?.content || '';
          if (content) {
            onOutput(content);
            onLastLine(content);
          }
        } catch {
          onOutput(line);
          onLastLine(line);
        }
      }
    }
  }
}
