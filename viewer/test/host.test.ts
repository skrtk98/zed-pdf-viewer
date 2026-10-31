import { describe, expect, it } from 'vitest';
import { createHost, isExternalUrlAllowed } from '../src/host';

function setup(prompts: (string | null)[] = []) {
  const posted: any[] = [];
  const opened: string[] = [];
  const errors: (string | null)[] = [];
  const fetches: { resolve: (d: Uint8Array) => void; reject: (e: Error) => void }[] = [];
  const host = createHost({
    fetchPdf: () => new Promise((resolve, reject) => fetches.push({ resolve, reject })),
    post: (m) => posted.push(m),
    prompt: () => prompts.shift() ?? null,
    openUrl: (u) => opened.push(u),
    showError: (m) => errors.push(m),
    settings: { defaultZoom: 2 },
  });
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { host, posted, opened, errors, fetches, settle };
}

const data = new Uint8Array([1]);

describe('host', () => {
  it('sends settings with the first load only', async () => {
    const t = setup();
    t.host.handleViewerMessage({ type: 'ready' });
    t.fetches[0].resolve(data);
    await t.settle();
    expect(t.posted[0]).toMatchObject({ type: 'load', data, defaultZoom: 2 });
    t.host.fileChanged();
    t.fetches[1].resolve(data);
    await t.settle();
    expect(t.posted[1].defaultZoom).toBeUndefined();
  });
  it('ignores file changes before the viewer is ready', () => {
    const t = setup();
    t.host.fileChanged();
    expect(t.fetches).toHaveLength(0);
  });
  it('delivers only the latest version when downloads overlap', async () => {
    const t = setup();
    t.host.handleViewerMessage({ type: 'ready' });
    t.host.fileChanged();
    const newer = new Uint8Array([2]);
    t.fetches[1].resolve(newer);
    t.fetches[0].resolve(data);
    await t.settle();
    expect(t.posted.map((m) => m.data)).toEqual([newer]);
  });
  it('keeps settings for the next load when the first download is superseded', async () => {
    const t = setup();
    t.host.handleViewerMessage({ type: 'ready' });
    t.host.fileChanged();
    t.fetches[1].resolve(data);
    await t.settle();
    expect(t.posted[0].defaultZoom).toBe(2);
  });
  it('reuses the password on reload and asks again when it is wrong', async () => {
    const t = setup(['bad', 'good']);
    t.host.handleViewerMessage({ type: 'ready' });
    t.host.handleViewerMessage({ type: 'requestPassword' });
    t.fetches[1].resolve(data);
    await t.settle();
    expect(t.posted[0].password).toBe('bad');
    t.host.handleViewerMessage({ type: 'error', message: 'Incorrect PDF password.' });
    t.fetches[2].resolve(data);
    await t.settle();
    expect(t.posted[1].password).toBe('good');
    t.host.fileChanged();
    t.fetches[3].resolve(data);
    await t.settle();
    expect(t.posted[2].password).toBe('good');
  });
  it('does nothing when the password prompt is cancelled', () => {
    const t = setup([null]);
    t.host.handleViewerMessage({ type: 'requestPassword' });
    expect(t.fetches).toHaveLength(0);
  });
  it('shows a download failure and clears it after the next success', async () => {
    const t = setup();
    t.host.handleViewerMessage({ type: 'ready' });
    t.fetches[0].reject(new Error('boom'));
    await t.settle();
    expect(t.errors.at(-1)).toContain('boom');
    t.host.fileChanged();
    t.fetches[1].resolve(data);
    await t.settle();
    expect(t.errors.at(-1)).toBeNull();
  });
  it('opens only safe external links', () => {
    const t = setup();
    t.host.handleViewerMessage({ type: 'openExternal', url: 'https://example.com' });
    t.host.handleViewerMessage({ type: 'openExternal', url: 'javascript:alert(1)' });
    expect(t.opened).toEqual(['https://example.com']);
    expect(t.errors.at(-1)).toContain('Blocked');
    expect(isExternalUrlAllowed('file:///etc/passwd')).toBe(false);
    expect(isExternalUrlAllowed('mailto:a@example.com')).toBe(true);
    expect(isExternalUrlAllowed('not a url')).toBe(false);
  });
});
