/**
 * Catalog price normalization: string parsing, RUB-only, registry lookup, live fetch (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { priceFromPricing, priceFromRegistry } from "../.pi/extensions/pi-polza/model-price.ts";
import type { ResolvedModel } from "../.pi/extensions/pi-polza/metadata/types.ts";

test("parses the decimal strings Polza publishes", () => {
  const price = priceFromPricing({
    currency: "RUB",
    prompt_per_million: "9.27728600",
    completion_per_million: "164.40760000",
  });
  assert.deepEqual(price, { input: 9.277286, output: 164.4076 });
});

test("accepts numbers too, and keeps one-sided data honest", () => {
  assert.deepEqual(priceFromPricing({ prompt_per_million: 5 }), { input: 5, output: null });
  assert.deepEqual(priceFromPricing({ completion_per_million: "12.5" }), { input: null, output: 12.5 });
});

test("missing, empty and negative values become unknown, never 0", () => {
  assert.equal(priceFromPricing(null), null);
  assert.equal(priceFromPricing({}), null);
  assert.equal(priceFromPricing({ prompt_per_million: "", completion_per_million: null }), null);
  assert.equal(priceFromPricing({ prompt_per_million: "-1" }), null);
  assert.equal(priceFromPricing({ prompt_per_million: "not-a-number" }), null);
});

test("a non-RUB pricing block is never shown as RUB", () => {
  const usd = { currency: "USD", prompt_per_million: "1", completion_per_million: "2" };
  assert.equal(priceFromPricing(usd, { requireRub: true }), null);
  // Without the flag the numbers are passed through (the registry is RUB by construction).
  assert.deepEqual(priceFromPricing(usd), { input: 1, output: 2 });
});

function resolvedModel(id: string, prompt: number | null, completion: number | null): ResolvedModel {
  return {
    id,
    pricing: {
      polzaRUB: {
        currency: "RUB",
        promptPerMillion: prompt,
        completionPerMillion: completion,
        cacheReadPerMillion: null,
        cacheWritePerMillion: null,
      },
      openRouterReference: null,
    },
  } as unknown as ResolvedModel;
}

test("registry lookup returns the catalog price of an exact model id", () => {
  const registry = [resolvedModel("z-ai/glm-5.3", 9.277286, 164.4076)];
  assert.deepEqual(priceFromRegistry(registry, "z-ai/glm-5.3"), { input: 9.277286, output: 164.4076 });
  // No prefix/fuzzy matching: an unknown id stays unknown.
  assert.equal(priceFromRegistry(registry, "z-ai/glm-5"), null);
  assert.equal(priceFromRegistry(registry, "anthropic/claude-haiku-5.5"), null);
});

test("registry model without published prices yields null", () => {
  assert.equal(priceFromRegistry([resolvedModel("x/image", null, null)], "x/image"), null);
});
