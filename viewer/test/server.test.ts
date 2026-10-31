import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { RunningServer, startServer } from '../src/server';

let dir: string;
let pdf: string;
let running: RunningServer | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-'));
  pdf = path.join(dir, 'a<b>.pdf');
  fs.writeFileSync(pdf, 'version 1');
});
afterEach(() => {
  running?.close();
  running = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const complete = (body: string) => `${body}\n%%EOF\n`;

const start = async (extra = {}) => {
  running = await startServer({ pdfPath: pdf, mediaDir: path.resolve('media'), pollMs: 10, ...extra });
  return running;
};

function rawGet(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { host } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject);
  });
}

/** Open the event stream and resolve the returned promise on the first change event. */
async function subscribe(url: string) {
  const controller = new AbortController();
  const res = await fetch(`${url}events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const changed = (async () => {
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: change')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      text += decoder.decode(value);
    }
  })();
  changed.catch(() => {});
  return { changed, abort: () => controller.abort() };
}

describe('viewer server', () => {
  it('moves to the next listed port when one is taken, keeping the Host check on the bound port', async () => {
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as AddressInfo).port;
    const free = http.createServer();
    await new Promise<void>((r) => free.listen(0, '127.0.0.1', r));
    const next = (free.address() as AddressInfo).port;
    await new Promise((r) => free.close(r));
    try {
      const { url } = await start({ ports: [taken, next] });
      expect(new URL(url).port).toBe(String(next));
      expect((await fetch(url)).status).toBe(200);
    } finally {
      blocker.close();
    }
  });
  it('reports when every listed port is taken', async () => {
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as AddressInfo).port;
    await expect(start({ ports: [taken] })).rejects.toThrow(`Port ${taken} already in use`);
    blocker.close();
  });
  it('rejects an invalid port number', async () => {
    await expect(start({ ports: [65536] })).rejects.toThrow();
  });
  it('binds to loopback and serves the page with an escaped title and settings', async () => {
    const { url } = await start({ defaultZoom: 1.5 });
    expect(new URL(url).hostname).toBe('127.0.0.1');
    const html = await (await fetch(url)).text();
    expect(html).toContain('<title>a&#60;b&#62;.pdf</title>');
    expect(html).toContain('window.VIEWER_SETTINGS = {"defaultZoom":1.5}');
    expect(html).not.toContain('${nonce}');
  });
  it('serves the PDF as currently on disk', async () => {
    const { url } = await start();
    expect(await (await fetch(`${url}document.pdf`)).text()).toBe('version 1');
    fs.writeFileSync(pdf, 'version 2');
    expect(await (await fetch(`${url}document.pdf`)).text()).toBe('version 2');
  });
  it('rejects requests without the token', async () => {
    const { url } = await start();
    const { origin } = new URL(url);
    expect((await fetch(`${origin}/document.pdf`)).status).toBe(404);
    expect((await fetch(`${origin}/wrong/document.pdf`)).status).toBe(404);
  });
  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const { url } = await start();
    expect(await rawGet(url, 'evil.example:80')).toBe(403);
  });
  it('rejects non-GET methods and media outside the allow list', async () => {
    const { url } = await start();
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${url}media/viewer.html`)).status).toBe(404);
    expect((await fetch(`${url}media/constructor`)).status).toBe(404);
    expect((await fetch(`${url}media/..%2f..%2fpackage.json`)).status).toBe(404);
  });
  it('notifies on a write and on an atomic rename over the file', async () => {
    const { url } = await start();
    const first = await subscribe(url);
    fs.writeFileSync(pdf, complete('version 2'));
    await first.changed;
    first.abort();

    const second = await subscribe(url);
    const temp = path.join(dir, 'temp');
    fs.writeFileSync(temp, complete('version three'));
    fs.renameSync(temp, pdf);
    await second.changed;
    second.abort();
  });
  it('keeps notifying after a clean build recreates the directory', async () => {
    const build = path.join(dir, 'build');
    fs.mkdirSync(build);
    pdf = path.join(build, 'paper.pdf');
    fs.writeFileSync(pdf, complete('version 1'));
    const { url } = await start();
    const sub = await subscribe(url);
    fs.rmSync(build, { recursive: true });
    await new Promise((r) => setTimeout(r, 40));
    fs.mkdirSync(build);
    fs.writeFileSync(pdf, complete('version 2'));
    await sub.changed;
    sub.abort();
  });
  it('does not notify while the file is empty or for other files', async () => {
    const { url } = await start();
    const sub = await subscribe(url);
    let fired = false;
    sub.changed.then(() => { fired = true; }, () => {});
    fs.writeFileSync(pdf, '');
    fs.writeFileSync(path.join(dir, 'other.pdf'), complete('x'));
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toBe(false);
    fs.writeFileSync(pdf, complete('version 2'));
    await sub.changed;
    sub.abort();
  });
  it('holds back a half-written file until its end marker arrives', async () => {
    const { url } = await start({ pollMs: 40 });
    const sub = await subscribe(url);
    let fired = false;
    sub.changed.then(() => { fired = true; }, () => {});
    fs.writeFileSync(pdf, 'partial');
    await new Promise((r) => setTimeout(r, 100));
    expect(fired).toBe(false);
    fs.appendFileSync(pdf, '\n%%EOF\n');
    await sub.changed;
    sub.abort();
  });
  it('eventually reloads a stable file that has no end marker', async () => {
    const { url } = await start();
    const sub = await subscribe(url);
    fs.writeFileSync(pdf, 'stable but unusual');
    await sub.changed;
    sub.abort();
  });
  it('shuts down after the last window disconnects, but not on a quick reconnect', async () => {
    let shutdown = false;
    const { url } = await start({ idleMs: 80, onShutdown: () => { shutdown = true; } });
    const first = await subscribe(url);
    first.abort();
    await new Promise((r) => setTimeout(r, 30));
    const second = await subscribe(url);
    await new Promise((r) => setTimeout(r, 150));
    expect(shutdown).toBe(false);
    second.abort();
    await new Promise((r) => setTimeout(r, 150));
    expect(shutdown).toBe(true);
  });
  it('shuts down if no window ever connects', async () => {
    let shutdown = false;
    await start({ startupMs: 20, onShutdown: () => { shutdown = true; } });
    await new Promise((r) => setTimeout(r, 80));
    expect(shutdown).toBe(true);
  });
});
