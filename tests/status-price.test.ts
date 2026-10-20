/**
 * Catalog price in the footer: formatting, rendering and the price cache (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolzaBalance } from "../.pi/extensions/pi-polza/balance.ts";
import type { ModelPrice } from "../.pi/extensions/pi-polza/model-price.ts";
import {
  PLAIN_STATUS_THEME,
  PRICE_RETRY_MS,
  PRICE_TTL_MS,
  PolzaStatusController,
  formatBalanceStatus,
  formatPricePerMillion,
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

function priceSnap(
  input: number | null,
  output: number | null,
  state: PriceSnapshot["state"] = "fresh",
  modelId = "z-ai/glm-5.3",
): PriceSnapshot {
  return { modelId, price: { input, output }, fetchedAt: 0, state };
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

test("formatPricePerMillion keeps cheap models distinguishable and wide ones short", () => {
  assert.equal(formatPricePerMillion(11.7434), "11.74");
  assert.equal(formatPricePerMillion(58.717), "58.72");
  assert.equal(formatPricePerMillion(9.277286), "9.28");
  assert.equal(formatPricePerMillion(587.17), "587.17");
  assert.equal(formatPricePerMillion(17615.1), "17615");
  assert.equal(formatPricePerMillion(0.460341), "0.460");
  assert.equal(formatPricePerMillion(0.08712), "0.0871");
  assert.equal(formatPricePerMillion(1), "1.00");
  assert.equal(formatPricePerMillion(null), null);
  assert.equal(formatPricePerMillion(Number.NaN), null);
  assert.equal(formatPricePerMillion(-1), null);
});

test("footer appends the catalog in/out price after the spend", () => {
  const text = formatBalanceStatus(snap(43.54, "fresh"), { requests: 2, costRub: 0.61 }, priceSnap(11.7434, 58.717));
  assert.equal(text, "Polza 43.54 ₽ | Spent 0.61 ₽ | (11.74 in / 58.72 out ₽/1M)");
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
  assert.ok(calls.some((c) => c.color === "text" && c.text === "11.74"));
  assert.ok(calls.some((c) => c.color === "text" && c.text === "58.72"));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === " in / "));
  assert.ok(calls.some((c) => c.color === "muted" && c.text === " out ₽/1M)"));
  assert.equal(calls.some((c) => c.color === "text" && c.text.includes("?")), false, "no placeholder is invented");
});

interface PriceHarness {
  controller: PolzaStatusController;
  fetches: () => number;
  fetchedIds: string[];
  advance: (ms: number) => void;
  last: () => string | undefined;
}

function buildPriceController(
  opts: {
    catalog?: ModelPrice | null;
    fetch?: (modelId: string) => Promise<ModelPrice | null>;
    modelId?: () => string | null;
  } = {},
): PriceHarness {
  const statuses: Array<string | undefined> = [];
  const fetchedIds: string[] = [];
  let now = 1_000_000;
  let fetchCount = 0;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => balance(43.5),
    getSessionCost: () => ({ requests: 1, costRub: 0.61 }),
    getActiveModelId: opts.modelId ?? (() => "z-ai/glm-5.3"),
    getCatalogPrice: () => (opts.catalog === undefined ? { input: 9.277286, output: 164.4076 } : opts.catalog),
    fetchPrice: async (modelId) => {
      fetchCount += 1;
      fetchedIds.push(modelId);
      return opts.fetch ? opts.fetch(modelId) : { input: 9.2773, output: 164.4076 };
    },
    now: () => now,
  });
  return {
    controller,
    fetchedIds,
    fetches: () => fetchCount,
    advance: (ms) => {
      now += ms;
    },
    last: () => statuses[statuses.length - 1],
  };
}

test("a registry price renders immediately and costs no request", async () => {
  const h = buildPriceController();
  h.controller.activate();
  assert.equal(h.last(), "Polza ? | Spent 0.61 ₽ | (9.28 in / 164.41 out ₽/1M)");
  await tick();
  assert.equal(h.fetches(), 0, "catalog price is used as-is while fresh");
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (9.28 in / 164.41 out ₽/1M)");
  assert.equal(h.controller.priceSnapshot?.state, "fresh");
});

test("a model missing from the registry is priced live, then cached for the TTL", async () => {
  const h = buildPriceController({ catalog: null, fetch: async () => ({ input: 44.0378, output: 220.1887 }) });
  h.controller.activate();
  await tick();
  assert.equal(h.fetches(), 1);
  assert.deepEqual(h.fetchedIds, ["z-ai/glm-5.3"]);
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (44.04 in / 220.19 out ₽/1M)");

  h.controller.requestCompleted();
  await tick();
  assert.equal(h.fetches(), 1, "fresh price is not refetched");

  h.advance(PRICE_TTL_MS - 1);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.fetches(), 1, "still inside the price TTL");

  h.advance(1);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.fetches(), 2, "refreshed exactly at the price TTL");
});

test("a failed price refresh keeps the last value and backs off", async () => {
  let failing = false;
  const h = buildPriceController({
    fetch: async () => {
      if (failing) throw new Error("network down");
      return { input: 9.2773, output: 164.4076 };
    },
  });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (9.28 in / 164.41 out ₽/1M)");

  failing = true;
  h.advance(PRICE_TTL_MS);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.controller.priceSnapshot?.state, "stale");
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽ | (9.28 in / 164.41 out ₽/1M)", "value survives the failure");
  const attempts = h.fetches();

  // Loader-style churn must not hammer a failing endpoint.
  for (let i = 0; i < 5; i += 1) {
    h.controller.requestCompleted();
    await tick();
  }
  assert.equal(h.fetches(), attempts, "no retry inside the backoff window");

  h.advance(PRICE_RETRY_MS);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.fetches(), attempts + 1, "retried after the backoff window");

  failing = false;
  h.advance(PRICE_RETRY_MS);
  h.controller.requestCompleted();
  await tick();
  assert.equal(h.controller.priceSnapshot?.state, "fresh");
});

test("switching models never paints the previous model's price", async () => {
  let current = "z-ai/glm-5.3";
  let resolvePending!: (value: ModelPrice | null) => void;
  const statuses: Array<string | undefined> = [];
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => balance(43.5),
    getSessionCost: () => ({ requests: 1, costRub: 0.61 }),
    getActiveModelId: () => current,
    // Only the second model is in the registry, so the first one needs a live request.
    getCatalogPrice: (modelId) =>
      modelId === "anthropic/claude-haiku-5.5" ? { input: 11.7434, output: 58.717 } : null,
    fetchPrice: (modelId) =>
      modelId === "z-ai/glm-5.3"
        ? new Promise((resolve) => {
            resolvePending = resolve;
          })
        : Promise.resolve({ input: 11.7434, output: 58.717 }),
    now: () => now,
  });

  controller.activate();
  await tick();
  assert.equal(statuses.at(-1), "Polza 43.50 ₽ | Spent 0.61 ₽", "nothing is invented while the price is unknown");

  current = "anthropic/claude-haiku-5.5";
  controller.modelChanged();
  assert.match(
    statuses.at(-1) ?? "",
    /\(11\.74 in \/ 58\.72 out ₽\/1M\)/,
    "registry price of the new model, immediately",
  );

  // A late answer for a model that is no longer selected must be ignored.
  resolvePending({ input: 999, output: 999 });
  await tick();
  assert.match(statuses.at(-1) ?? "", /\(11\.74 in \/ 58\.72 out ₽\/1M\)/);
});

test("price disappears when the provider is not Polza", async () => {
  let modelId: string | null = "z-ai/glm-5.3";
  const h = buildPriceController({ modelId: () => modelId });
  h.controller.activate();
  await tick();
  assert.match(h.last() ?? "", /out ₽\/1M\)/);

  modelId = null;
  h.controller.modelChanged();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽", "price is dropped, balance/spend still render");
  // index.ts calls deactivate() for a non-Polza provider, which clears the line entirely.
  h.controller.deactivate();
  assert.equal(h.last(), undefined);
});
