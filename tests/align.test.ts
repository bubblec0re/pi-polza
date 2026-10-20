/**
 * Footer right alignment: width resolution, padding and survival of Pi's status sanitizer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FALLBACK_COLUMNS,
  PAD_UNIT,
  RIGHT_ALIGN_RESERVE,
  padStatusForRightAlign,
  resolveColumns,
} from "../.pi/extensions/pi-polza/align.ts";

const plain = (text: string): number => text.length;

const ansi = new RegExp("\u001b\[[0-9;]*m", "g");

/** Cell width of a padded line: every pad unit occupies exactly one cell, colors none. */
const cells = (text: string): number => text.replace(ansi, "").split(PAD_UNIT).join(" ").length;

/**
 * Verbatim copy of Pi's `sanitizeStatusText` (dist/modes/interactive/components/footer.js).
 * Status text is not rendered as written, which is the reason PAD_UNIT exists.
 */
const sanitizeStatusText = (text: string): string =>
  text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();

test("resolveColumns mirrors pi-tui: stream width, then COLUMNS, then 80", () => {
  assert.equal(resolveColumns({ columns: 120 }, {}), 120);
  assert.equal(resolveColumns({ columns: undefined }, { COLUMNS: "132" }), 132);
  assert.equal(resolveColumns({ columns: 0 }, { COLUMNS: "100" }), 100);
  assert.equal(resolveColumns({}, {}), FALLBACK_COLUMNS);
  assert.equal(resolveColumns({ columns: 99.7 }, {}), 99);
});

test("pads to the right edge, keeping one spare cell", () => {
  const text = "Polza 43.54 ₽ | Spent 0.61 ₽ | (11.74 in / 58.72 out ₽/1M)";
  const padded = padStatusForRightAlign(text, 120, plain);
  assert.equal(cells(padded), 120 - RIGHT_ALIGN_RESERVE);
  assert.ok(padded.endsWith(text));
  assert.ok(padded.startsWith(PAD_UNIT.repeat(120 - RIGHT_ALIGN_RESERVE - text.length)));
});

test("plain leading spaces would be destroyed by Pi's sanitizer", () => {
  assert.equal(sanitizeStatusText(`${" ".repeat(20)}Polza 43.54 ₽`), "Polza 43.54 ₽");
});

test("the pad survives Pi's sanitizer unchanged", () => {
  const text = "Polza 43.54 ₽ | Spent 0.61 ₽ | (11.74 in / 58.72 out ₽/1M)";
  const padded = padStatusForRightAlign(text, 120, plain);
  const sanitized = sanitizeStatusText(padded);
  assert.equal(sanitized, padded, "padding is not collapsed or trimmed");
  assert.equal(cells(sanitized), cells(padded), "right edge stays where it was");
});

test("measures with the injected helper, so ANSI colors do not shift the padding", () => {
  const colored = "\u001b[2mPolza\u001b[0m \u001b[1m43.54 ₽\u001b[0m";
  const visible = (value: string): number => value.replace(/\u001b\[[0-9;]*m/g, "").length;
  const padded = padStatusForRightAlign(colored, 40, visible);
  assert.equal(cells(padded), 40 - RIGHT_ALIGN_RESERVE);
  assert.ok(padded.endsWith(colored));
});

test("never truncates: text that already fills the line is returned unchanged", () => {
  const text = "x".repeat(80);
  assert.equal(padStatusForRightAlign(text, 80, plain), text);
  assert.equal(padStatusForRightAlign(text, 40, plain), text);
  assert.equal(padStatusForRightAlign("short", 0, plain), "short");
  assert.equal(padStatusForRightAlign("short", Number.NaN, plain), "short");
});
