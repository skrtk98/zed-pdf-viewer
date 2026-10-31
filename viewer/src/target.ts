import * as fs from 'fs';
import * as path from 'path';

const SKIPPED_DIRS = new Set(['node_modules', 'target']);
const MAX_DEPTH = 6;

function isPdf(file: string): boolean {
  return path.extname(file).toLowerCase() === '.pdf';
}

/** Find the most recently modified PDF under `dir`, skipping dot and build directories. */
function newestPdf(dir: string, depth = 0): { file: string; mtimeMs: number } | null {
  let newest: { file: string; mtimeMs: number } | null = null;
  const consider = (candidate: { file: string; mtimeMs: number } | null) => {
    if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) newest = candidate;
  };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)) {
        consider(newestPdf(file, depth + 1));
      }
    } else if (entry.isFile() && isPdf(entry.name)) {
      try {
        consider({ file, mtimeMs: fs.statSync(file).mtimeMs });
      } catch {
        // The file disappeared while scanning.
      }
    }
  }
  return newest;
}

/**
 * Resolve the CLI argument to a PDF path.
 *
 * Zed cannot open a PDF in a buffer, so `$ZED_FILE` is normally the document
 * source. A non-PDF path therefore means the PDF beside it with the same stem
 * (`paper.tex` → `paper.pdf`), and a directory means its newest PDF.
 *
 * @throws Error with a user-facing message when no PDF can be found.
 */
export function resolveTarget(arg: string, cwd = process.cwd()): string {
  const absolute = path.resolve(cwd, arg);
  const stat = fs.statSync(absolute, { throwIfNoEntry: false });

  if (stat?.isDirectory()) {
    const newest = newestPdf(absolute);
    if (!newest) throw new Error(`No PDF found under ${absolute}`);
    return newest.file;
  }
  if (isPdf(absolute)) {
    if (!stat) throw new Error(`File not found: ${absolute}`);
    return absolute;
  }
  const sibling = path.join(path.dirname(absolute), `${path.parse(absolute).name}.pdf`);
  if (!fs.existsSync(sibling)) throw new Error(`No PDF found for ${absolute} (looked for ${sibling})`);
  return sibling;
}
