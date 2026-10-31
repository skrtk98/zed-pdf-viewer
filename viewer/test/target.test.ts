import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveTarget } from '../src/target';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'target-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(name: string, mtime = 1000): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  fs.utimesSync(file, mtime, mtime);
  return file;
}

describe('resolveTarget', () => {
  it('returns a PDF path as is, resolved against cwd', () => {
    const pdf = write('a.PDF');
    expect(resolveTarget('a.PDF', dir)).toBe(pdf);
  });
  it('rejects a missing PDF', () => {
    expect(() => resolveTarget('none.pdf', dir)).toThrow('File not found');
  });
  it('maps a source file to the PDF with the same stem', () => {
    const pdf = write('paper.pdf');
    write('paper.tex');
    expect(resolveTarget('paper.tex', dir)).toBe(pdf);
  });
  it('explains where it looked when the sibling PDF is missing', () => {
    write('paper.typ');
    expect(() => resolveTarget('paper.typ', dir)).toThrow(path.join(dir, 'paper.pdf'));
  });
  it('picks the newest PDF in a directory, skipping dot and build directories', () => {
    write('old.pdf', 1000);
    const newest = write('sub/new.pdf', 2000);
    write('node_modules/x.pdf', 3000);
    write('.git/x.pdf', 3000);
    write('target/x.pdf', 3000);
    expect(resolveTarget('.', dir)).toBe(newest);
  });
  it('rejects a directory without PDFs', () => {
    expect(() => resolveTarget('.', dir)).toThrow('No PDF found');
  });
});
