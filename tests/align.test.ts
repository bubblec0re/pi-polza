/**
 * Footer right alignment: width resolution, padding and survival of Pi's status sanitizer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FALLBACK_COLUMNS,
  PAD_UNIT,
  RIGHT_ALIGN_RESERVE,
  resolveColumns,
  splitStatusLine,
} from "../.pi/extensions/pi-polza/align.ts";

const plain = (text: string): number => text.length;

const ESC = String.fromCharCode(27);

/** Drop the SGR sequences the theme inserts (no regex: keeps the intent obvious). */
function stripAnsi(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === ESC) {
      const end = value.indexOf("m", index);
      index = end === -1 ? value.length : end;
      continue;
    }
    out += value[index];
  }
  return out;
}

/** Cell width of a line: every pad unit occupies exactly one cell, colors none. */
const cells = (text: string): number => stripAnsi(text).split(PAD_UNIT).join(" ").length;


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

const LEFT = "Polza 43.54 ₽ | Spent 0.61 ₽";
const RIGHT = "(11.74 in / 58.72 out ₽/1M)";

test("keeps the left half in place and puts the right half on the edge", () => {
  const line = splitStatusLine(LEFT, RIGHT, 120, plain);
  assert.ok(line.startsWith(LEFT), "balance and spend stay left-aligned");
  assert.ok(line.endsWith(RIGHT), "price ends the line");
  assert.equal(cells(line), 120 - RIGHT_ALIGN_RESERVE);
});

test("plain spaces between the halves would be destroyed by Pi's sanitizer", () => {
  assert.equal(sanitizeStatusText(`${LEFT}${" ".repeat(30)}${RIGHT}`), `${LEFT} ${RIGHT}`);
});

test("the gap survives Pi's sanitizer, so both halves keep their place", () => {
  for (const columns of [120, 80, 60]) {
    const line = splitStatusLine(LEFT, RIGHT, columns, plain);
    const sanitized = sanitizeStatusText(line);
    assert.equal(sanitized, line, `${columns} cols: gap is not collapsed`);
    assert.ok(sanitized.startsWith(LEFT));
    assert.ok(sanitized.endsWith(RIGHT));
    assert.equal(cells(sanitized), columns - RIGHT_ALIGN_RESERVE);
  }
});

test("degrades to adjacency when there is no room for a gap", () => {
  const wide = "(17615 in / 70460 out ₽/1M)";
  const line = splitStatusLine(LEFT, wide, 50, plain);
  assert.equal(line, `${LEFT} ${wide}`);
  assert.equal(splitStatusLine(LEFT, RIGHT, 0, plain), `${LEFT} ${RIGHT}`);
  assert.equal(splitStatusLine(LEFT, RIGHT, Number.NaN, plain), `${LEFT} ${RIGHT}`);
});

test("measures with the injected helper, so ANSI colors do not shift the layout", () => {
  const coloredLeft = `${ESC}[2mPolza${ESC}[0m ${ESC}[1m43.54 ₽${ESC}[0m`;
  const coloredRight = `${ESC}[2m(11.74 in / 58.72 out ₽/1M)${ESC}[0m`;
  const visible = (value: string): number => stripAnsi(value).length;
  const line = splitStatusLine(coloredLeft, coloredRight, 120, visible);
  assert.equal(cells(line), 120 - RIGHT_ALIGN_RESERVE);
  assert.ok(line.startsWith(coloredLeft));
  assert.ok(line.endsWith(coloredRight));
});

test("never truncates: parts that already fill the line are returned adjacent", () => {
  const text = "x".repeat(80);
  assert.equal(splitStatusLine(text, "y", 80, plain), `${text} y`);
  assert.equal(splitStatusLine(text, "y", 40, plain), `${text} y`);
});
