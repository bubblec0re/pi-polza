/**
 * Footer right alignment: width resolution and space padding (no TUI needed).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FALLBACK_COLUMNS,
  RIGHT_ALIGN_RESERVE,
  padStatusForRightAlign,
  resolveColumns,
} from "../.pi/extensions/pi-polza/align.ts";

const plain = (text: string): number => text.length;

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
  assert.equal(padded.length, 120 - RIGHT_ALIGN_RESERVE);
  assert.equal(padded.trimStart(), text);
  assert.ok(padded.startsWith(" ".repeat(120 - RIGHT_ALIGN_RESERVE - text.length)));
});

test("measures with the injected helper, so ANSI colors do not shift the padding", () => {
  const colored = "\u001b[2mPolza\u001b[0m \u001b[1m43.54 ₽\u001b[0m";
  const visible = (value: string): number => value.replace(/\u001b\[[0-9;]*m/g, "").length;
  const padded = padStatusForRightAlign(colored, 40, visible);
  assert.equal(padded.length, colored.length + 40 - RIGHT_ALIGN_RESERVE - visible(colored));
  assert.ok(padded.endsWith(colored));
});

test("never truncates: text that already fills the line is returned unchanged", () => {
  const text = "x".repeat(80);
  assert.equal(padStatusForRightAlign(text, 80, plain), text);
  assert.equal(padStatusForRightAlign(text, 40, plain), text);
  assert.equal(padStatusForRightAlign("short", 0, plain), "short");
  assert.equal(padStatusForRightAlign("short", Number.NaN, plain), "short");
});
