import type { Context } from 'hono';
import { getDb } from '../db/database.js';

const encoder = new TextEncoder();

export interface SSEEvent {
  id: number;
  event: string;
  data: unknown;
}

interface SSEClient {
  controller: ReadableStreamDefaultController;
  closed: boolean;
}

const HEARTBEAT_INTERVAL = 15_000;

export class SSEBroadcaster {
  private clients = new Set<SSEClient>();
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

        // Events are persisted so reconnects survive a server restart.
        if (lastEventId) {
          const id = parseInt(lastEventId, 10);
          if (!isNaN(id)) {
            const db = getDb();
            const bounds = db.query<{ oldest: number | null; newest: number | null }, []>(
              'SELECT MIN(id) AS oldest, MAX(id) AS newest FROM events'
            ).get();
            if (bounds?.oldest != null && id < bounds.oldest - 1) {
              this.writeToClient(client, { id: bounds.newest ?? id, event: 'stale', data: {} });
            } else if (bounds?.newest != null && id < bounds.newest) {
              const rows = db.query<{ id: number; topic: string; payload: string }, [number]>(
                'SELECT id, topic, payload FROM events WHERE id > ? ORDER BY id ASC LIMIT 1000'
              ).all(id);
              for (const row of rows) this.writeToClient(client, { id: row.id, event: row.topic, data: JSON.parse(row.payload) });
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

  broadcastPersisted(sseEvent: SSEEvent): void {
    const snapshot = [...this.clients];
    for (const client of snapshot) {
      this.writeToClient(client, sseEvent);
    }
  }

  private writeToClient(client: SSEClient, event: SSEEvent): void {
    if (client.closed) return;
    try {
      const msg = `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
      client.controller.enqueue(encoder.encode(msg));
    } catch {
      this.removeClient(client);
    }
  }

  private sendHeartbeat(): void {
    const snapshot = [...this.clients];
    for (const client of snapshot) {
      if (client.closed) continue;
      try {
        client.controller.enqueue(encoder.encode(': heartbeat\n\n'));
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
