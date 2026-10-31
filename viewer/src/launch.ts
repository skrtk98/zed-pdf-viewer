import { fork, spawn } from 'child_process';

/** Ports used over SSH, where they must be forwarded in advance. Keep in sync with the README. */
export const REMOTE_PORTS = [39123, 39124, 39125, 39126, 39127];

/** On SSH the opener can only reach the remote machine, and the user has to follow a link. */
export const REMOTE_STARTUP_MS = 5 * 60_000;

export function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT);
}

export interface ViewOptions {
  ports?: number[];
  startupMs?: number;
  defaultZoom?: number;
  renderResolution?: number;
  noOpen?: boolean;
}

/** How long to wait for an opener to report failure; some stay running with the browser. */
const OPENER_FAILURE_WINDOW_MS = 2_000;

/** Open a URL in the default browser. Resolves false if the opener could not start or failed. */
export function openInBrowser(url: string): Promise<boolean> {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] :
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
    ['xdg-open', [url]];
  return new Promise((resolve) => {
    const child = spawn(command as string, args as string[], { detached: true, stdio: 'ignore' });
    const finish = (opened: boolean) => {
      clearTimeout(timer);
      child.unref();
      resolve(opened);
    };
    const timer = setTimeout(() => finish(true), OPENER_FAILURE_WINDOW_MS);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
  });
}

/**
 * Start a background server for `pdfPath` and return its URL.
 *
 * The server outlives this process, so a Zed task finishes immediately instead
 * of occupying a terminal tab for as long as the PDF is open.
 */
export function startBackgroundServer(cliPath: string, pdfPath: string, options: ViewOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = fork(cliPath, ['serve', pdfPath, JSON.stringify(options)], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out starting the viewer server'));
    }, 10_000);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Viewer server exited with code ${code}`));
    });
    child.once('message', (msg: { url?: string; error?: string }) => {
      clearTimeout(timer);
      child.removeAllListeners('exit');
      child.disconnect();
      child.unref();
      if (msg.url) resolve(msg.url);
      else reject(new Error(msg.error ?? 'Viewer server failed to start'));
    });
  });
}
