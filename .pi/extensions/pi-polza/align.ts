/**
 * Right alignment for an extension status line (`ctx.ui.setStatus`).
 *
 * Pi has no alignment API here: it joins every extension status on one line, left-aligned, and
 * truncates the tail (`dist/modes/interactive/components/footer.js`). Pi right-aligns its own model
 * name with plain spaces inside `render(width)`:
 *
 *     const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
 *     statsLine = statsLeft + padding + rightSide;
 *
 * The same trick is used below, with the same width source pi-tui exposes
 * (`process.stdout.columns || COLUMNS || 80`) and the same width measurement (`visibleWidth`).
 *
 * Pi does not render the status string verbatim: `sanitizeStatusText()` collapses runs of spaces and
 * trims the result (`dist/modes/interactive/components/footer.js`), so plain leading spaces are
 * destroyed and never reach the screen. The pad unit below interleaves a zero-width space with each
 * space: the run is never longer than one space (so the collapse leaves it alone), `trim()` does not
 * treat U+200B as whitespace, and `visibleWidth()` counts every unit as exactly one cell. If Pi ever
 * normalizes zero-width characters away the line simply falls back to left alignment — nothing else
 * in the footer changes.
 *
 * Trade-off, documented in `notes/model-price-footer.md`: the padding is part of the status text, and
 * if another extension adds its own status the joined line overflows and Pi cuts the tail.
 */

/** Terminal width used by pi-tui when the stream does not report one. */
export const FALLBACK_COLUMNS = 80;

/** One spare cell is kept so a line at the exact edge cannot wrap. */
export const RIGHT_ALIGN_RESERVE = 1;

/**
 * One cell of padding that survives Pi's status sanitizer: zero-width space + space.
 * Do not simplify it to a plain space — `sanitizeStatusText()` would collapse the whole run.
 */
export const PAD_UNIT = "\u200b ";

export type WidthMeasure = (text: string) => number;

/** Mirrors pi-tui's `Terminal.columns`. */
export function resolveColumns(
  stdout: { columns?: number | undefined } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const reported = typeof stdout.columns === "number" && Number.isFinite(stdout.columns) ? stdout.columns : 0;
  if (reported > 0) return Math.floor(reported);
  const fromEnv = Number(env.COLUMNS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return FALLBACK_COLUMNS;
}

/**
 * Lay out `left` at the start of the line and `right` at the end of it.
 *
 * The gap between them is built from PAD_UNIT (see above), so balance/spend stay left-aligned while
 * the price sits on the right edge — the same visual result as Pi's own stats line.
 * When there is not enough room the parts stay adjacent (one space): Pi truncates the line anyway,
 * and dropping the gap is better than pushing the right part out of view.
 */
export function splitStatusLine(
  left: string,
  right: string,
  columns: number,
  measure: WidthMeasure,
): string {
  if (!Number.isFinite(columns) || columns <= 0) return `${left} ${right}`;
  const gap = Math.floor(columns) - RIGHT_ALIGN_RESERVE - measure(left) - measure(right);
  return gap > 0 ? `${left}${PAD_UNIT.repeat(gap)}${right}` : `${left} ${right}`;
}
