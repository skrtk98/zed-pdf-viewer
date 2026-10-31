/**
 * Browser-side stand-in for the VS Code webview host.
 *
 * viewer.ts is kept identical to upstream and talks to its host through
 * `acquireVsCodeApi().postMessage` and `window` `message` events. This script
 * implements that protocol over HTTP, so it must load before viewer.js.
 */

export interface HostEnv {
  fetchPdf(): Promise<Uint8Array>;
  /** Deliver a message to the viewer. */
  post(message: unknown): void;
  prompt(message: string): string | null;
  openUrl(url: string): void;
  showError(message: string | null): void;
  settings: { defaultZoom?: number; renderResolution?: number };
}

export function isExternalUrlAllowed(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function createHost(env: HostEnv) {
  let ready = false;
  let password: string | undefined;
  let loadId = 0;
  // Sent with the first load that reaches the viewer, not the first one requested.
  let pendingSettings: HostEnv['settings'] = env.settings;

  const load = async () => {
    const id = ++loadId;
    try {
      const data = await env.fetchPdf();
      if (id !== loadId) return; // A newer version arrived while this one was downloading.
      env.showError(null);
      env.post({ type: 'load', data, password, ...pendingSettings });
      pendingSettings = {};
    } catch (err) {
      if (id === loadId) env.showError(`Failed to read PDF: ${String(err)}`);
    }
  };

  const askPassword = (message: string) => {
    const answer = env.prompt(message);
    if (answer === null) return;
    password = answer;
    void load();
  };

  return {
    handleViewerMessage(msg: { type: string; url?: string; message?: string }): void {
      switch (msg.type) {
        case 'ready':
          ready = true;
          void load();
          break;
        case 'openExternal':
          if (msg.url && isExternalUrlAllowed(msg.url)) env.openUrl(msg.url);
          else env.showError(`Blocked link: ${msg.url}`);
          break;
        case 'requestPassword':
          askPassword('Enter PDF password');
          break;
        case 'error':
          if (msg.message === 'Incorrect PDF password.') askPassword('Incorrect password. Enter PDF password');
          else env.showError(msg.message ?? 'Unknown error');
          break;
      }
    },
    fileChanged(): void {
      if (ready) void load();
    },
  };
}

declare global {
  interface Window {
    VIEWER_SETTINGS: { defaultZoom?: number; renderResolution?: number };
    acquireVsCodeApi(): { postMessage(msg: unknown): void };
  }
}

if (typeof window !== 'undefined') {
  const showError = (message: string | null) => {
    const el = document.getElementById('host-error')!;
    el.textContent = message ?? '';
    el.classList.toggle('visible', message !== null);
  };
  const host = createHost({
    fetchPdf: async () => {
      const res = await fetch('document.pdf');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    post: (message) => window.postMessage(message, window.location.origin),
    prompt: (message) => window.prompt(message),
    openUrl: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); },
    showError,
    settings: window.VIEWER_SETTINGS,
  });
  window.acquireVsCodeApi = () => ({
    postMessage: (msg) => host.handleViewerMessage(msg as { type: string }),
  });

  const events = new EventSource('events');
  let disconnected = false;
  events.addEventListener('open', () => {
    if (disconnected) {
      showError(null);
      // The file may have changed while no event could arrive.
      host.fileChanged();
    }
    disconnected = false;
  });
  events.addEventListener('change', () => host.fileChanged());
  events.addEventListener('error', () => {
    disconnected = true;
    showError('Connection to the viewer server was lost. Automatic reload is paused; run the viewer again to reconnect.');
  });
}
