// Line-level diff used by the review pane.
//
// Pure and dependency-free so it can be unit tested without a browser. Falls
// back to a whole-file replacement for very large inputs rather than spending
// quadratic time computing an optimal alignment.

export type DiffLine = {
  type: 'same' | 'add' | 'del';
  text: string;
  leftLine: number | null;
  rightLine: number | null;
};

const MAX_LCS_LINES = 1500;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];

  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [
      ...a.map((text, index) => ({ type: 'del' as const, text, leftLine: index + 1, rightLine: null })),
      ...b.map((text, index) => ({ type: 'add' as const, text, leftLine: null, rightLine: index + 1 })),
    ];
  }

  // Classic LCS table, then backtrack into an ordered edit script.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i], leftLine: i + 1, rightLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: 'del', text: a[i], leftLine: i + 1, rightLine: null });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j], leftLine: null, rightLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ type: 'del', text: a[i], leftLine: i + 1, rightLine: null });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: 'add', text: b[j], leftLine: null, rightLine: j + 1 });
    j += 1;
  }
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === 'add') added += 1;
    else if (line.type === 'del') removed += 1;
  }
  return { added, removed };
}

/** Collapse long runs of unchanged lines into a context window. */
export function collapseContext(lines: DiffLine[], context = 3): Array<DiffLine | { type: 'skip'; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.type === 'same') return;
    for (let offset = Math.max(0, index - context); offset <= Math.min(lines.length - 1, index + context); offset += 1) keep[offset] = true;
  });

  const output: Array<DiffLine | { type: 'skip'; count: number }> = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        output.push({ type: 'skip', count: skipped });
        skipped = 0;
      }
      output.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped > 0) output.push({ type: 'skip', count: skipped });
  return output;
}
