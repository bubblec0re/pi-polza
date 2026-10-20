/**
 * Catalog price in the footer: formatting, rendering and the price cache (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolzaBalance } from "../.pi/extensions/pi-polza/balance.ts";
import type { PolzaPricingRUB } from "../.pi/extensions/pi-polza/metadata/types.ts";
import { rubPerMillion } from "../.pi/extensions/pi-polza/presentation.ts";
import { PAD_UNIT, RIGHT_ALIGN_RESERVE } from "../.pi/extensions/pi-polza/align.ts";
import {
  PLAIN_STATUS_THEME,
  PolzaStatusController,
  PRICE_FRACTION_DIGITS,
  formatBalanceStatus,
  polzaStatusModel,
  renderPolzaStatus,
  type BalanceSnapshot,
  type PriceSnapshot,
  type StatusTheme,
} from "../.pi/extensions/pi-polza/status.ts";

function balance(available: number): PolzaBalance {
  return { amount: available, available, reservedAmount: 0, spentAmount: 0, currency: "RUB" };
}

function snap(value: number | null, state: BalanceSnapshot["state"]): BalanceSnapshot {
  return { value, state, fetchedAt: 0 };
}

/** Catalog pricing record, exactly the shape the registry holds. */
function pricing(input: number | null, output: number | null): PolzaPricingRUB {
  return {
    currency: "RUB",
    promptPerMillion: input,
    completionPerMillion: output,
    cacheReadPerMillion: null,
    cacheWritePerMillion: null,
  };
}

function priceSnap(
  input: number | null,
  output: number | null,
  state: PriceSnapshot["state"] = "fresh",
  modelId = "z-ai/glm-5.3",
): PriceSnapshot {
  return { modelId, price: pricing(input, output), fetchedAt: 0, state };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Collect footer output exactly as Pi would render it with no colors. */
const pushPlain = (statuses: Array<string | undefined>) => (model: Parameters<typeof renderPolzaStatus>[1] | undefined) =>
  statuses.push(model ? renderPolzaStatus(PLAIN_STATUS_THEME, model) : undefined);

function recordingTheme(): { theme: StatusTheme; calls: Array<{ color: string; text: string }> } {
  const calls: Array<{ color: string; text: string }> = [];
  return {
    calls,
    theme: {
      fg: (color, text) => {
        calls.push({ color, text });
        return `[${color}]${text}`;
      },
      bold: (text) => text,
    },
  };
}

test("the footer prints prices with the same formatter as /polza-model-info", () => {
  // One helper, one unit: the panel shows the published value, the footer asks for two decimals.
  assert.equal(rubPerMillion(11.7434), "11.7434 ₽ / 1M");
  assert.equal(rubPerMillion(11.7434, PRICE_FRACTION_DIGITS), "11.74 ₽ / 1M");
  assert.equal(rubPerMillion(17615.1, PRICE_FRACTION_DIGITS), "17615.10 ₽ / 1M");
  assert.equal(rubPerMillion(null), "unknown");
});

test("footer appends the catalog in/out price after the spend", () => {
  const text = formatBalanceStatus(snap(43.54, "fresh"), { requests: 2, costRub: 0.61 }, priceSnap(11.7434, 58.717));
  assert.equal(text, "Polza 43.54 ₽ | Spent 0.61 ₽ | (in 11.74 ₽ / 1M · out 58.72 ₽ / 1M)");
});

test("price is omitted instead of guessed when it is unknown or one-sided", () => {
  assert.equal(
    formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }),
    "Polza 43.54 ₽ | Spent 0.61 ₽",
  );
  const unknown = { modelId: "x/y", price: null, fetchedAt: 0, state: "unknown" as const };
  assert.equal(
    formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }, unknown),
    "Polza 43.54 ₽ | Spent 0.61 ₽",
  );
  // A one-sided price would read as if the other half were free.
  assert.equal(
    formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }, priceSnap(11.74, null)),
    "Polza 43.54 ₽ | Spent 0.61 ₽",
  );
});

test("price values use the normal text colour, hints stay muted and faint", () => {
  const { theme, calls } = recordingTheme();
  renderPolzaStatus(
    theme,
    polzaStatusModel(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }, priceSnap(11.74, 58.72)),
  );
  assert.ok(calls.some((c) => c.color === "text" && c.text === "11.74 ₽ / 1M"));
  assert.ok(calls.some((c) => c.color === "text" && c.text === "58.72 ₽ / 1M"));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === "in "));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === " · out "));
  assert.equal(calls.some((c) => c.color === "text" && c.text.includes("?")), false, "no placeholder is invented");
});

interface PriceHarness {
  controller: PolzaStatusController;
  advance: (ms: number) => void;
  last: () => string | undefined;
}

function buildPriceController(
  opts: { catalog?: (modelId: string) => PolzaPricingRUB | null; modelId?: () => string | null } = {},
): PriceHarness {
  const statuses: Array<string | undefined> = [];
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => balance(43.5),
    getSessionCost: () => ({ requests: 1, costRub: 0.61 }),
    getActiveModelId: opts.modelId ?? (() => "z-ai/glm-5.3"),
    getModelPricing: (modelId) => (opts.catalog ? opts.catalog(modelId) : pricing(9.277286, 164.4076)),
    now: () => now,
  });
  return {
    controller,
    advance: (ms) => {
      now += ms;
    },
    last: () => statuses[statuses.length - 1],
  };
}

test("a registry price renders immediately and is never re-requested", async () => {
  const h = buildPriceController();
  h.controller.activate();
  assert.equal(h.last(), "Polza ? | Spent 0.61 ₽ | (in 9.28 ₽ / 1M · out 164.41 ₽ / 1M)");
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (in 9.28 ₽ / 1M · out 164.41 ₽ / 1M)");
  assert.equal(h.controller.priceSnapshot?.state, "fresh");

  // Nothing about time passing may trigger a price refresh: the registry is the source.
  h.advance(24 * 60 * 60 * 1000);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (in 9.28 ₽ / 1M · out 164.41 ₽ / 1M)");
});

test("a model outside the catalog has no price segment", async () => {
  const h = buildPriceController({ catalog: () => null });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽");
  assert.equal(h.controller.priceSnapshot?.state, "unknown");
});

test("the catalog rebuild re-reads prices, including for a model that had none", async () => {
  let price: PolzaPricingRUB | null = null;
  const h = buildPriceController({ catalog: () => price });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽", "not in the catalog yet");

  price = pricing(44.0378, 220.1887);
  h.controller.catalogUpdated();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (in 44.04 ₽ / 1M · out 220.19 ₽ / 1M)");
});

test("switching models shows the new model's registry price immediately", async () => {
  let current = "z-ai/glm-5.3";
  const statuses: Array<string | undefined> = [];
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => balance(43.5),
    getSessionCost: () => ({ requests: 1, costRub: 0.61 }),
    getActiveModelId: () => current,
    getModelPricing: (modelId) =>
      modelId === "z-ai/glm-5.3" ? pricing(9.277286, 164.4076) : pricing(11.7434, 58.717),
    now: () => now,
  });

  controller.activate();
  await tick();
  assert.match(statuses.at(-1) ?? "", /\(in 9\.28 ₽ \/ 1M · out 164\.41 ₽ \/ 1M\)/);

  current = "anthropic/claude-haiku-5.5";
  controller.modelChanged();
  assert.match(statuses.at(-1) ?? "", /\(in 11\.74 ₽ \/ 1M · out 58\.72 ₽ \/ 1M\)/);
});

test("price disappears when the provider is not Polza", async () => {
  let modelId: string | null = "z-ai/glm-5.3";
  const h = buildPriceController({ modelId: () => modelId });
  h.controller.activate();
  await tick();
  assert.match(h.last() ?? "", /out 164\.41 ₽ \/ 1M\)/);

  modelId = null;
  h.controller.modelChanged();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽", "price is dropped, balance/spend still render");
  // index.ts calls deactivate() for a non-Polza provider, which clears the line entirely.
  h.controller.deactivate();
  assert.equal(h.last(), undefined);
});

const cells = (text: string): number => text.split(PAD_UNIT).join(" ").length;

test("with a layout the account stays left and the price moves to the right edge", () => {
  const model = polzaStatusModel(snap(43.54, "fresh"), { requests: 2, costRub: 0.61 }, priceSnap(11.7434, 58.717));
  const line = renderPolzaStatus(PLAIN_STATUS_THEME, model, { columns: 120, measure: (text) => text.length });
  assert.ok(line.startsWith("Polza 43.54 ₽ | Spent 0.61 ₽"), "balance and spend keep the left edge");
  assert.ok(line.endsWith("(in 11.74 ₽ / 1M · out 58.72 ₽ / 1M)"), "price ends the line");
  assert.equal(cells(line), 120 - RIGHT_ALIGN_RESERVE);
  assert.ok(line.includes(PAD_UNIT), "the two halves are separated by a gap, not by a space run");
});

test("without a layout (plain callers, tests) the halves keep the pipe separator", () => {
  const model = polzaStatusModel(snap(43.54, "fresh"), { requests: 2, costRub: 0.61 }, priceSnap(11.7434, 58.717));
  assert.equal(renderPolzaStatus(PLAIN_STATUS_THEME, model), "Polza 43.54 ₽ | Spent 0.61 ₽ | (in 11.74 ₽ / 1M · out 58.72 ₽ / 1M)");
});
