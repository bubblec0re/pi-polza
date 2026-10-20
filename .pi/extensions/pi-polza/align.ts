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
 * Trade-off, documented in `notes/model-price-footer.md`: the padding is part of the status text, and
 * if another extension adds its own status the joined line overflows and Pi cuts the tail.
 */

/** Terminal width used by pi-tui when the stream does not report one. */
export const FALLBACK_COLUMNS = 80;

/** One spare cell is kept so a line at the exact edge cannot wrap. */
export const RIGHT_ALIGN_RESERVE = 1;

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
 * Prefix `text` with the spaces that push it to the right edge.
 * Returns the text unchanged when it already fills the line (never truncates: Pi does that).
 */
export function padStatusForRightAlign(text: string, columns: number, measure: WidthMeasure): string {
  if (!Number.isFinite(columns) || columns <= 0) return text;
  const pad = Math.floor(columns) - RIGHT_ALIGN_RESERVE - measure(text);
  return pad > 0 ? `${" ".repeat(pad)}${text}` : text;
}
