/**
 * Registry price lookup: the footer must read the same field `/polza-model-info` prints (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { priceFromRegistry } from "../.pi/extensions/pi-polza/model-price.ts";
import type { ResolvedModel } from "../.pi/extensions/pi-polza/metadata/types.ts";

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

test("returns the catalog price of an exact model id", () => {
  const registry = [resolvedModel("z-ai/glm-5.3", 9.277286, 164.4076)];
  assert.deepEqual(priceFromRegistry(registry, "z-ai/glm-5.3"), { input: 9.277286, output: 164.4076 });
});

test("no fuzzy matching: only the exact id has a price", () => {
  const registry = [resolvedModel("z-ai/glm-5.3", 9.277286, 164.4076)];
  assert.equal(priceFromRegistry(registry, "z-ai/glm-5"), null);
  assert.equal(priceFromRegistry(registry, "anthropic/claude-haiku-5.5"), null);
  assert.equal(priceFromRegistry([], "z-ai/glm-5.3"), null);
});

test("a registry model without published prices yields null, never 0", () => {
  assert.equal(priceFromRegistry([resolvedModel("x/image", null, null)], "x/image"), null);
});

test("one-sided catalog data is passed through honestly", () => {
  assert.deepEqual(priceFromRegistry([resolvedModel("x/y", 5, null)], "x/y"), { input: 5, output: null });
  assert.deepEqual(priceFromRegistry([resolvedModel("x/y", null, 12.5)], "x/y"), { input: null, output: 12.5 });
});
