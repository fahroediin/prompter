import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createServer as createNetServer, Server as HttpServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeServer } from '../../src/main/server';
import type { ListenerErrorMsg } from '../../src/shared/messages';

function publicDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pub-'));
  writeFileSync(join(d, 'listener.html'), '<!doctype html><title>x</title>');
  return d;
}

let server: BridgeServer | undefined;
let blocker: HttpServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (blocker) {
    await new Promise<void>((resolve) => blocker!.close(() => resolve()));
    blocker = undefined;
  }
});

/**
 * Connects and immediately starts buffering every message into a queue, so
 * that the server's on-connect start/stop message (sent synchronously on
 * 'connection', which can race a listener attached after 'open' resolves)
 * is never missed. `next()` reads from that queue.
 */
function connect(url: string): Promise<{ ws: WebSocket; next: () => Promise<any> }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const queue: any[] = [];
    const waiters: ((v: any) => void)[] = [];
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    });
    ws.on('open', () =>
      res({
        ws,
        next: () =>
          new Promise((r) => {
            if (queue.length > 0) r(queue.shift());
            else waiters.push(r);
          }),
      })
    );
    ws.on('error', rej);
  });
}

describe('BridgeServer', () => {
  it('serves listener.html over http', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/listener.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>');
  });

  it('exposes url pointing at listener.html on the bound port', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    expect(server.url).toBe(`http://127.0.0.1:${port}/listener.html`);
  });

  it('only serves .html files, 404s otherwise', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/nope.txt`);
    expect(res.status).toBe(404);
  });

  it('relays transcript from client to onTranscript', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const got: any[] = [];
    server.onTranscript((m) => got.push(m));
    const { ws, next } = await connect(`ws://127.0.0.1:${port}/ws`);
    await next(); // initial start/stop message
    ws.send(JSON.stringify({ type: 'transcript', text: 'halo', isFinal: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(got[0]).toEqual({ type: 'transcript', text: 'halo', isFinal: true });
    ws.close();
  });

  it('sends stop to a client that connects while paused (reconnect safety)', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    server.setPaused(true);
    const { next, ws } = await connect(`ws://127.0.0.1:${port}/ws`);
    const msg = await next();
    expect(msg).toEqual({ type: 'stop' });
    ws.close();
  });

  it('sends start to a client that connects while running', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    server.setPaused(false);
    const { next, ws } = await connect(`ws://127.0.0.1:${port}/ws`);
    const msg = await next();
    expect(msg).toEqual({ type: 'start' });
    ws.close();
  });

  it('sendState() re-sends stop/start to all connected clients on demand', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const { next, ws } = await connect(`ws://127.0.0.1:${port}/ws`);
    await next(); // initial start
    server.setPaused(true);
    server.sendState();
    const msg = await next();
    expect(msg).toEqual({ type: 'stop' });
    ws.close();
  });

  it('routes listener-error messages to onListenerError, not onTranscript', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const transcripts: any[] = [];
    const errors: ListenerErrorMsg[] = [];
    server.onTranscript((m) => transcripts.push(m));
    server.onListenerError((m) => errors.push(m));
    const { ws, next } = await connect(`ws://127.0.0.1:${port}/ws`);
    await next(); // initial start/stop
    ws.send(JSON.stringify({ type: 'listener-error', code: 'network' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toEqual([{ type: 'listener-error', code: 'network' }]);
    expect(transcripts).toEqual([]);
    ws.close();
  });

  it('reports client count via onClientCount as clients connect and disconnect', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const counts: number[] = [];
    server.onClientCount((n) => counts.push(n));
    const { ws, next } = await connect(`ws://127.0.0.1:${port}/ws`);
    await next();
    await new Promise((r) => setTimeout(r, 20));
    expect(counts).toContain(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(counts).toContain(0);
  });

  it('broadcasts a ServerToClient message to all connected clients', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const { ws, next } = await connect(`ws://127.0.0.1:${port}/ws`);
    await next(); // initial start/stop
    server.broadcast({ type: 'status', code: 'ok' });
    const msg = await next();
    expect(msg).toEqual({ type: 'status', code: 'ok' });
    ws.close();
  });

  it('falls back to the next port when the start port is occupied', async () => {
    const startPort = 47821;
    blocker = createNetServer();
    await new Promise<void>((resolve, reject) => {
      blocker!.on('error', reject);
      blocker!.listen(startPort, '127.0.0.1', () => resolve());
    });
    server = new BridgeServer({ publicDir: publicDir(), startPort, endPort: 47830 });
    const port = await server.start();
    expect(port).toBe(startPort + 1);
  });
});
