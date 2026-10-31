import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { createMcpHandler } from '../src/mcp';

const fixture = path.resolve('test/fixtures/simple.pdf');

function setup() {
  const opened: string[] = [];
  const handle = createMcpHandler(async (p) => { opened.push(p); return `Opened ${p}`; });
  return { handle, opened };
}
const call = (args: object) => ({ id: 1, method: 'tools/call', params: { name: 'open_pdf', arguments: args } });

describe('MCP server', () => {
  it('echoes the requested protocol version on initialize', async () => {
    const res: any = await setup().handle({ id: 1, method: 'initialize', params: { protocolVersion: 'x' } });
    expect(res.result.protocolVersion).toBe('x');
    expect(res.result.capabilities.tools).toBeDefined();
  });
  it('rejects JSON that is not a request object', async () => {
    for (const value of [null, 3, []]) {
      expect(((await setup().handle(value as any)) as any).error.code).toBe(-32600);
    }
  });
  it('does not answer notifications', async () => {
    expect(await setup().handle({ method: 'notifications/initialized' })).toBeNull();
  });
  it('lists the tool and reports unknown methods', async () => {
    const { handle } = setup();
    expect(((await handle({ id: 1, method: 'tools/list' })) as any).result.tools[0].name).toBe('open_pdf');
    expect(((await handle({ id: 2, method: 'nope' })) as any).error.code).toBe(-32601);
  });
  it('opens an existing absolute PDF', async () => {
    const { handle, opened } = setup();
    const res: any = await handle(call({ path: fixture }));
    expect(res.result.isError).toBeUndefined();
    expect(opened).toEqual([fixture]);
  });
  it('refuses relative paths, non-PDF files, and missing files', async () => {
    const { handle, opened } = setup();
    for (const p of ['simple.pdf', path.resolve('package.json'), path.resolve('none.pdf'), 3]) {
      expect(((await handle(call({ path: p }))) as any).result.isError).toBe(true);
    }
    expect(opened).toEqual([]);
  });
});
