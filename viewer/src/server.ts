import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { AddressInfo } from 'net';

export interface ServerOptions {
  pdfPath: string;
  mediaDir: string;
  /** Ports to try in order on 127.0.0.1; 0 picks a free one. Defaults to [0]. */
  ports?: number[];
  defaultZoom?: number;
  renderResolution?: number;
  /** Shut down this long after the last browser window disconnects. */
  idleMs?: number;
  /** Shut down if no browser window connects within this time. */
  startupMs?: number;
  /** How often to check the PDF for changes. */
  pollMs?: number;
  onShutdown?: () => void;
}

export interface RunningServer {
  url: string;
  close(): void;
}

const MEDIA_TYPES: Record<string, string> = {
  'viewer.css': 'text/css; charset=utf-8',
  'viewer.js': 'text/javascript; charset=utf-8',
  'viewer.js.map': 'application/json',
  'worker.js': 'text/javascript; charset=utf-8',
  'worker.js.map': 'application/json',
  'host.js': 'text/javascript; charset=utf-8',
  'host.js.map': 'application/json',
  'mupdf.js': 'text/javascript; charset=utf-8',
  'mupdf-wasm.js': 'text/javascript; charset=utf-8',
  'mupdf.wasm': 'application/wasm',
};

const HEARTBEAT_MS = 15_000;
/** Reload a changed file without a PDF end marker after this many unchanged polls. */
const INCOMPLETE_POLLS = 6;
const EOF_MARKER_WINDOW = 1024;

function fileVersion(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return stat.size > 0 ? `${stat.mtimeMs}:${stat.size}` : null;
  } catch {
    return null; // Missing or unreadable, for example during a clean build.
  }
}

/** Whether the file ends with a PDF end marker, which a build writes last. */
function hasEofMarker(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      const length = Math.min(size, EOF_MARKER_WINDOW);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      return buffer.includes('%%EOF');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Serve one PDF and the viewer assets on the loopback interface.
 *
 * The server replaces the VS Code extension host: it provides the PDF bytes and
 * tells the page when the file changes. Every URL carries a random token, and
 * the Host header is checked, so web pages cannot read the document. The token
 * is visible in the browser opener's process arguments, so this does not protect
 * against other users on a shared machine. It exits by itself once no browser
 * window is connected.
 */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const { pdfPath, mediaDir, idleMs = 30_000, startupMs = 60_000, pollMs = 500 } = options;
  const token = crypto.randomBytes(24).toString('hex');
  const prefix = `/${token}/`;
  const settings = JSON.stringify({
    defaultZoom: options.defaultZoom,
    renderResolution: options.renderResolution,
  });
  const clients = new Set<http.ServerResponse>();
  let shutdownTimer: NodeJS.Timeout | null = null;
  let closed = false;
  let port = 0;

  const send = (res: http.ServerResponse, status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  };

  const scheduleShutdown = (delay: number) => {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(close, delay);
  };

  const page = async (res: http.ServerResponse) => {
    const template = await fs.promises.readFile(path.join(mediaDir, 'viewer.html'), 'utf8');
    const values: Record<string, string> = {
      nonce: crypto.randomBytes(16).toString('base64'),
      title: escapeHtml(path.basename(pdfPath)),
      settings,
    };
    const html = template.replace(/\$\{(nonce|title|settings)\}/g, (_, key: string) => values[key]);
    send(res, 200, 'text/html; charset=utf-8', html);
  };

  const events = (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    req.on('close', () => {
      clients.delete(res);
      if (clients.size === 0 && !closed) scheduleShutdown(idleMs);
    });
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return send(res, 403, 'text/plain', 'Forbidden');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain', 'Method not allowed');
    }
    const pathname = (req.url ?? '').split('?')[0];
    if (!pathname.startsWith(prefix)) return send(res, 404, 'text/plain', 'Not found');
    const route = pathname.slice(prefix.length);

    if (route === '') return page(res);
    if (route === 'events') return events(req, res);
    if (route === 'document.pdf') {
      return send(res, 200, 'application/pdf', await fs.promises.readFile(pdfPath));
    }
    if (route.startsWith('media/')) {
      const name = route.slice('media/'.length);
      if (Object.hasOwn(MEDIA_TYPES, name)) {
        return send(res, 200, MEDIA_TYPES[name], await fs.promises.readFile(path.join(mediaDir, name)));
      }
    }
    send(res, 404, 'text/plain', 'Not found');
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) send(res, 500, 'text/plain', String(err?.message ?? err));
      else res.destroy();
    });
  });

  let shownVersion = fileVersion(pdfPath);
  let candidate = shownVersion;
  let stablePolls = 0;

  // Poll the path instead of using fs.watch: a watcher stops following the file when
  // a clean build deletes and recreates its directory. Requiring an unchanged version
  // across polls and an end marker keeps a half-written PDF from replacing a good one.
  const poll = setInterval(() => {
    const version = fileVersion(pdfPath);
    if (version !== candidate) {
      candidate = version;
      stablePolls = 0;
      return;
    }
    if (version === null || version === shownVersion) return;
    stablePolls++;
    if (hasEofMarker(pdfPath) || stablePolls >= INCOMPLETE_POLLS) {
      shownVersion = version;
      for (const client of clients) client.write('event: change\ndata: {}\n\n');
    }
  }, pollMs);

  // Detect connections that died without closing, such as after a suspend.
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  function close(): void {
    if (closed) return;
    closed = true;
    if (shutdownTimer) clearTimeout(shutdownTimer);
    clearInterval(poll);
    clearInterval(heartbeat);
    server.close();
    server.closeAllConnections();
    options.onShutdown?.();
  }

  const ports = options.ports ?? [0];
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      clearInterval(poll);
      clearInterval(heartbeat);
      reject(err);
    };
    let index = 0;
    const listen = () => {
      try {
        server.listen(ports[index], '127.0.0.1');
      } catch (err) {
        fail(err as Error); // An invalid port number throws instead of emitting 'error'.
      }
    };
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') return fail(err);
      if (++index < ports.length) return listen();
      fail(new Error(`Port ${ports.join(', ')} already in use. Close a viewer window and try again.`));
    };
    server.on('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      port = (server.address() as AddressInfo).port;
      scheduleShutdown(startupMs);
      resolve({ url: `http://127.0.0.1:${port}${prefix}`, close });
    });
    listen();
  });
}
