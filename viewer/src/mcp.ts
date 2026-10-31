import * as path from 'path';
import * as readline from 'readline';
import * as fs from 'fs';

interface Request {
  id?: number | string;
  method: string;
  params?: any;
}

const FALLBACK_PROTOCOL_VERSION = '2025-06-18';

const OPEN_PDF_TOOL = {
  name: 'open_pdf',
  description: 'Open a PDF file in the MuPDF Viewer browser window. The viewer reloads automatically when the file changes.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path of the PDF file' },
    },
    required: ['path'],
  },
};

/**
 * Build the MCP request handler. Zed's extension API has no way to show a view,
 * so this tool is what the extension itself contributes: it lets the Agent panel
 * open a PDF for the user.
 *
 * @returns A function that maps a request to a response, or null for notifications.
 */
export function createMcpHandler(openPdf: (pdfPath: string) => Promise<string>) {
  const callTool = async (params: any) => {
    if (params?.name !== OPEN_PDF_TOOL.name) throw new RpcError(-32602, `Unknown tool: ${params?.name}`);
    const pdfPath = params.arguments?.path;
    const failure = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
    if (typeof pdfPath !== 'string' || !path.isAbsolute(pdfPath)) return failure('path must be an absolute path');
    if (path.extname(pdfPath).toLowerCase() !== '.pdf') return failure('path must be a .pdf file');
    if (!fs.statSync(pdfPath, { throwIfNoEntry: false })?.isFile()) return failure(`File not found: ${pdfPath}`);
    try {
      return { content: [{ type: 'text', text: await openPdf(pdfPath) }] };
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
  };

  const dispatch = async (req: Request) => {
    switch (req.method) {
      case 'initialize':
        return {
          protocolVersion: req.params?.protocolVersion ?? FALLBACK_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'mupdf-viewer', version: '0.1.0' },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: [OPEN_PDF_TOOL] };
      case 'tools/call':
        return callTool(req.params);
      default:
        throw new RpcError(-32601, `Method not found: ${req.method}`);
    }
  };

  return async (req: Request): Promise<object | null> => {
    if (req === null || typeof req !== 'object' || Array.isArray(req)) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    }
    if (req.id === undefined) return null;
    try {
      return { jsonrpc: '2.0', id: req.id, result: await dispatch(req) };
    } catch (err) {
      const code = err instanceof RpcError ? err.code : -32603;
      return { jsonrpc: '2.0', id: req.id, error: { code, message: String((err as Error).message) } };
    }
  };
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** Serve MCP over stdio: one JSON-RPC message per line. */
export function runMcpServer(openPdf: (pdfPath: string) => Promise<string>): void {
  const handle = createMcpHandler(openPdf);
  const write = (msg: object) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    let req: Request;
    try {
      req = JSON.parse(line);
    } catch {
      return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const res = await handle(req);
    if (res) write(res);
  });
}
