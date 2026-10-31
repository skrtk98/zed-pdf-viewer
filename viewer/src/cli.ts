import * as path from 'path';
import { parseArgs } from 'util';
import { isRemoteSession, openInBrowser, REMOTE_PORTS, REMOTE_STARTUP_MS, startBackgroundServer, ViewOptions } from './launch';
import { runMcpServer } from './mcp';
import { startServer } from './server';
import { resolveTarget } from './target';

const USAGE = `Usage: mupdf-viewer <file-or-directory> [options]
       mupdf-viewer mcp

Opens a PDF in the default browser and reloads it when the file changes.
A non-PDF path opens the PDF beside it with the same name (paper.tex -> paper.pdf).
A directory opens its most recently modified PDF.

Options:
  --zoom <number>   Initial zoom (default 1)
  --dpi <number>    Render resolution (default 96)
  --port <number>   Port to bind on 127.0.0.1 (default: any free port)
  --no-open         Print the URL without opening a browser
  --remote          Use SSH behavior without relying on SSH detection
  --local           Treat an SSH session as local: open a browser there, use any free port
  --help            Show this help

"mcp" runs the MCP server used by the Zed extension.

Over SSH (detected from SSH_CONNECTION, SSH_TTY, or SSH_CLIENT), no browser is opened
and a port from ${REMOTE_PORTS[0]}-${REMOTE_PORTS[REMOTE_PORTS.length - 1]} is used, which must be forwarded to your machine.`;

const MEDIA_DIR = path.join(__dirname, '..', 'media');

function positiveNumber(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number`);
  return parsed;
}

async function view(pdfPath: string, options: ViewOptions, remote = isRemoteSession(process.env)): Promise<{ url: string; opened: boolean; remote: boolean }> {
  const url = await startBackgroundServer(__filename, pdfPath, {
    ...options,
    ...(remote ? { ports: options.ports ?? REMOTE_PORTS, startupMs: REMOTE_STARTUP_MS, noOpen: true } : {}),
  });
  const opened = !remote && !options.noOpen && (await openInBrowser(url));
  return { url, opened, remote };
}

/** Internal entry point of the background process started by startBackgroundServer. */
async function serve(pdfPath: string, rawOptions: string): Promise<void> {
  const options: ViewOptions = JSON.parse(rawOptions);
  try {
    const { url } = await startServer({
      ...options,
      pdfPath,
      mediaDir: MEDIA_DIR,
      onShutdown: () => process.exit(0),
    });
    process.send?.({ url });
  } catch (err) {
    process.send?.({ error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'serve') return serve(argv[1], argv[2]);
  if (argv[0] === 'mcp') {
    return runMcpServer(async (pdfPath) => {
      const { url, opened, remote } = await view(pdfPath, {});
      if (opened) return `Opened ${pdfPath} at ${url}`;
      return remote
        ? `This is an SSH session, so no browser was opened. Show the user this link to open within 5 minutes: ${url} . It works only if the user forwards the same port number from their machine to this host, for example with port_forwards in Zed's ssh_connections settings.`
        : `Could not open a browser. Ask the user to open ${url} within 60 seconds.`;
    });
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      zoom: { type: 'string' },
      dpi: { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      remote: { type: 'boolean' },
      local: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
    return;
  }
  if (values.remote && values.local) throw new Error('--remote and --local cannot be used together');
  const port = positiveNumber('port', values.port);
  const { url, opened, remote } = await view(resolveTarget(positionals[0]), {
    defaultZoom: positiveNumber('zoom', values.zoom),
    renderResolution: positiveNumber('dpi', values.dpi),
    ports: port === undefined ? undefined : [port],
    noOpen: values['no-open'],
  }, values.remote ? true : values.local ? false : undefined);
  if (remote) console.error('Open this link in your browser within 5 minutes (the port must be forwarded):');
  else if (!opened && !values['no-open']) console.error('Could not open a browser. Open this URL within 60 seconds:');
  console.log(url);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
