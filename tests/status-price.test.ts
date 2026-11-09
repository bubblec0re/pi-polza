/**
 * Catalog price in the footer: formatting, rendering and the price cache (no network).
 *
 * The status is one left-aligned line: `Polza <balance> ₽ | Spent <cost> ₽ | <model>: in X ₽ / 1M ·
 * out Y ₽ / 1M`. Pi owns the width — if it does not fit, Pi truncates the tail.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolzaBalance } from "../.pi/extensions/pi-polza/balance.ts";
import type { PolzaPricingRUB } from "../.pi/extensions/pi-polza/metadata/types.ts";
import { rubPerMillion } from "../.pi/extensions/pi-polza/presentation.ts";
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

test("footer appends the model name and the catalog in/out price after the spend", () => {
  const text = formatBalanceStatus(snap(43.54, "fresh"), { requests: 2, costRub: 0.61 }, priceSnap(11.7434, 58.717), "z-ai/glm-5.3");
  assert.equal(text, "Polza 43.54 ₽ | Spent 0.61 ₽ | z-ai/glm-5.3: in 11.74 ₽ / 1M · out 58.72 ₽ / 1M");
});

test("the model name is shown even when its price is unknown; the price is never invented", () => {
  // No model selected: only the account line.
  assert.equal(
    formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }),
    "Polza 43.54 ₽ | Spent 0.61 ₽",
  );
  // Model selected, price unknown: the name is shown, no price is fabricated.
  const unknown = { modelId: "x/y", price: null, fetchedAt: 0, state: "unknown" as const };
  assert.equal(
    formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }, unknown, "x/y"),
    "Polza 43.54 ₽ | Spent 0.61 ₽ | x/y",
  );
  // A one-sided price would read as if the other half were free.
  assert.equal(
    formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }, priceSnap(11.74, null), "x/y"),
    "Polza 43.54 ₽ | Spent 0.61 ₽ | x/y",
  );
});

test("price values use the normal text colour; the model name and hints stay muted", () => {
  const { theme, calls } = recordingTheme();
  renderPolzaStatus(
    theme,
    polzaStatusModel(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }, priceSnap(11.74, 58.72), "z-ai/glm-5.3"),
  );
  assert.ok(calls.some((c) => c.color === "text" && c.text === "11.74 ₽ / 1M"));
  assert.ok(calls.some((c) => c.color === "text" && c.text === "58.72 ₽ / 1M"));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === "in "));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === " · out "));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === "z-ai/glm-5.3"), "the model name is muted");
  assert.equal(calls.some((c) => c.color === "text" && c.text.includes("?")), false, "no placeholder is invented");
});

test("the status is one left-aligned line: account, then model name and price", () => {
  const model = polzaStatusModel(snap(43.54, "fresh"), { requests: 2, costRub: 0.61 }, priceSnap(11.7434, 58.717), "deepseek/deepseek-r1");
  const line = renderPolzaStatus(PLAIN_STATUS_THEME, model);
  assert.equal(line, "Polza 43.54 ₽ | Spent 0.61 ₽ | deepseek/deepseek-r1: in 11.74 ₽ / 1M · out 58.72 ₽ / 1M");
  assert.ok(line.startsWith("Polza 43.54 ₽ | Spent 0.61 ₽"), "the account keeps the left edge");
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
  assert.equal(h.last(), "Polza ? ₽ | Spent 0.61 ₽ | z-ai/glm-5.3: in 9.28 ₽ / 1M · out 164.41 ₽ / 1M");
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | z-ai/glm-5.3: in 9.28 ₽ / 1M · out 164.41 ₽ / 1M");
  assert.equal(h.controller.priceSnapshot?.state, "fresh");

  // Nothing about time passing may trigger a price refresh: the registry is the source.
  h.advance(24 * 60 * 60 * 1000);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | z-ai/glm-5.3: in 9.28 ₽ / 1M · out 164.41 ₽ / 1M");
});

test("a model outside the catalog shows its name but no price segment", async () => {
  const h = buildPriceController({ catalog: () => null });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | z-ai/glm-5.3");
  assert.equal(h.controller.priceSnapshot?.state, "unknown");
});

test("the catalog rebuild re-reads prices, including for a model that had none", async () => {
  let price: PolzaPricingRUB | null = null;
  const h = buildPriceController({ catalog: () => price });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | z-ai/glm-5.3", "not in the catalog yet");

  price = pricing(44.0378, 220.1887);
  h.controller.catalogUpdated();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | z-ai/glm-5.3: in 44.04 ₽ / 1M · out 220.19 ₽ / 1M");
});

test("switching models shows the new model's name and registry price immediately", async () => {
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
  assert.match(statuses.at(-1) ?? "", /z-ai\/glm-5\.3: in 9\.28 ₽ \/ 1M · out 164\.41 ₽ \/ 1M/);

  current = "anthropic/claude-haiku-5.5";
  controller.modelChanged();
  assert.match(statuses.at(-1) ?? "", /anthropic\/claude-haiku-5\.5: in 11\.74 ₽ \/ 1M · out 58\.72 ₽ \/ 1M/);
});

test("price and model name disappear when the provider is not Polza", async () => {
  let modelId: string | null = "z-ai/glm-5.3";
  const h = buildPriceController({ modelId: () => modelId });
  h.controller.activate();
  await tick();
  assert.match(h.last() ?? "", /out 164\.41 ₽ \/ 1M/);

  modelId = null;
  h.controller.modelChanged();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽", "model and price dropped, balance/spend still render");
  // index.ts calls deactivate() for a non-Polza provider, which clears the line entirely.
  h.controller.deactivate();
  assert.equal(h.last(), undefined);
});
