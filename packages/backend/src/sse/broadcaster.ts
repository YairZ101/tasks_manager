import type { Context } from 'hono';

export interface SSEEvent {
  id: number;
  event: string;
  data: unknown;
}

interface SSEClient {
  controller: ReadableStreamDefaultController;
  closed: boolean;
}

const BUFFER_SIZE = 1000;
const HEARTBEAT_INTERVAL = 15_000;

class SSEBroadcaster {
  private clients = new Set<SSEClient>();
  private buffer: SSEEvent[] = [];
  private nextId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients) {
      this.removeClient(client);
    }
  }

  connect(c: Context, lastEventId?: string): Response {
    let client: SSEClient;

    const stream = new ReadableStream({
      start: (controller) => {
        client = { controller, closed: false };
        this.clients.add(client);

        // Replay missed events
        if (lastEventId) {
          const id = parseInt(lastEventId, 10);
          if (!isNaN(id)) {
            const oldest = this.buffer.length > 0 ? this.buffer[0].id : this.nextId;
            if (id < oldest || (this.buffer.length === 0 && id >= this.nextId)) {
              // Buffer doesn't cover the requested ID (too old, or server restarted)
              this.writeToClient(client, { id: this.allocId(), event: 'stale', data: {} });
            } else {
              // Replay events after the last received one
              for (const evt of this.buffer) {
                if (evt.id > id) {
                  this.writeToClient(client, evt);
                }
              }
            }
          }
        }
      },
      cancel: () => {
        if (client) {
          this.removeClient(client);
        }
      },
    });

    // Listen for client disconnect via request abort signal
    c.req.raw.signal.addEventListener('abort', () => {
      if (client) {
        this.removeClient(client);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  broadcast(event: string, data: unknown): void {
    const sseEvent: SSEEvent = {
      id: this.allocId(),
      event,
      data,
    };

    // Add to ring buffer
    this.buffer.push(sseEvent);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }

    // Send to all clients
    const snapshot = [...this.clients];
    for (const client of snapshot) {
      this.writeToClient(client, sseEvent);
    }
  }

  private allocId(): number {
    return this.nextId++;
  }

  private writeToClient(client: SSEClient, event: SSEEvent): void {
    if (client.closed) return;
    try {
      const msg = `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
      client.controller.enqueue(new TextEncoder().encode(msg));
    } catch {
      this.removeClient(client);
    }
  }

  private sendHeartbeat(): void {
    const snapshot = [...this.clients];
    for (const client of snapshot) {
      if (client.closed) continue;
      try {
        client.controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      } catch {
        this.removeClient(client);
      }
    }
  }

  private removeClient(client: SSEClient): void {
    if (client.closed) return;
    client.closed = true;
    try {
      client.controller.close();
    } catch {
      // Already closed
    }
    this.clients.delete(client);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const broadcaster = new SSEBroadcaster();
