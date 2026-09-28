import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize as pathNormalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerToClient, ClientToServer, ListenerErrorMsg } from '../shared/messages';

export class BridgeServer {
  private publicDir: string;
  private startPort: number;
  private endPort: number;
  private http?: Server;
  private wss?: WebSocketServer;
  private port = 0;
  private paused = false;
  private transcriptCbs: ((m: ClientToServer) => void)[] = [];
  private listenerErrorCbs: ((m: ListenerErrorMsg) => void)[] = [];
  private countCbs: ((n: number) => void)[] = [];

  constructor(opts: { publicDir: string; startPort?: number; endPort?: number }) {
    this.publicDir = opts.publicDir;
    this.startPort = opts.startPort ?? 47821;
    this.endPort = opts.endPort ?? 47830;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/listener.html`;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  onTranscript(cb: (m: ClientToServer) => void): void {
    this.transcriptCbs.push(cb);
  }

  onListenerError(cb: (m: ListenerErrorMsg) => void): void {
    this.listenerErrorCbs.push(cb);
  }

  onClientCount(cb: (n: number) => void): void {
    this.countCbs.push(cb);
  }

  broadcast(msg: ServerToClient): void {
    const data = JSON.stringify(msg);
    this.wss?.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  /** Sends the current start/stop state to all connected clients (AC-05.06 reconnect safety). */
  sendState(): void {
    this.broadcast(this.paused ? { type: 'stop' } : { type: 'start' });
  }

  private serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const urlPath = (req.url ?? '/').split('?')[0];
    const rel = pathNormalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const file = join(this.publicDir, rel === '/' ? 'listener.html' : rel);
    if (extname(file) !== '.html' || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(file));
  }

  private emitCount(): void {
    const n = this.wss?.clients.size ?? 0;
    this.countCbs.forEach((cb) => cb(n));
  }

  async start(): Promise<number> {
    for (let p = this.startPort; p <= this.endPort; p++) {
      try {
        await this.listenOn(p);
        this.port = p;
        return p;
      } catch (e: any) {
        if (e?.code !== 'EADDRINUSE') throw e;
      }
    }
    throw new Error(`no free port in ${this.startPort}..${this.endPort}`);
  }

  private listenOn(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => this.serveStatic(req, res));
      const wss = new WebSocketServer({ server: http, path: '/ws' });
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify(this.paused ? { type: 'stop' } : { type: 'start' }));
        this.emitCount();
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as ClientToServer;
            if (msg?.type === 'transcript') {
              this.transcriptCbs.forEach((cb) => cb(msg));
            } else if (msg?.type === 'listener-error') {
              this.listenerErrorCbs.forEach((cb) => cb(msg));
            }
          } catch {
            /* ignore malformed */
          }
        });
        ws.on('close', () => this.emitCount());
      });
      // The ws library re-emits the underlying http server's 'error' event on
      // the WebSocketServer instance itself (see ws/lib/websocket-server.js),
      // rather than leaving it solely on `http`, so both must be handled or
      // an EADDRINUSE (etc.) surfaces as an unhandled 'error' event on `wss`.
      const onError = (err: Error) => {
        http.removeListener('error', onError);
        wss.removeListener('error', onError);
        wss.close();
        http.close();
        reject(err);
      };
      http.once('error', onError);
      wss.once('error', onError);
      http.listen(port, '127.0.0.1', () => {
        http.removeListener('error', onError);
        wss.removeListener('error', onError);
        this.http = http;
        this.wss = wss;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.http) {
        resolve();
        return;
      }
      this.wss?.close();
      this.wss?.clients.forEach((c) => c.terminate());
      this.http.close(() => resolve());
      this.http = undefined;
      this.wss = undefined;
    });
  }
}
