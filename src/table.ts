/** 极简等宽表格（中文按显示宽度近似处理）。 */

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[^\u0000-\u00ff]/.test(ch) ? 2 : 1;
  }
  return w;
}

function pad(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = Math.max(0, width - displayWidth(s));
  return align === 'left' ? s + ' '.repeat(gap) : ' '.repeat(gap) + s;
}

export function renderTable(
  headers: string[],
  rows: Array<Array<string | number>>,
  numericRight = true,
): string {
  const strRows = rows.map((r) => r.map((c) => String(c)));
  const widths = headers.map((h, j) =>
    Math.max(displayWidth(h), ...strRows.map((r) => displayWidth(r[j] ?? ''))),
  );
  const line = (cells: string[], isHeader: boolean) =>
    cells
      .map((c, j) => {
        const asNumber = !isHeader && numericRight && /^-?\d/.test(c);
        return pad(c, widths[j], asNumber ? 'right' : 'left');
      })
      .join('  ');
  const out = [line(headers, true), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const r of strRows) out.push(line(r, false));
  return out.join('\n');
}

export function fmt(x: number, digits = 10): string {
  if (!Number.isFinite(x)) return String(x);
  if (Math.abs(x) < 1e-15 && x !== 0) return x.toExponential(4);
  return Number(x.toFixed(digtsSafe(digits))).toString();
}

function digtsSafe(d: number): number {
  return d;
}
