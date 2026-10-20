/**
 * Per-model catalog price in native RUB (per 1 000 000 tokens).
 *
 * The price is read from the in-memory registry (`ResolvedModel.pricing.polzaRUB`), which is filled
 * from the Polza catalog that Pi fetches at every start (and again on `/polza-refresh`). It is the
 * same field the `/polza-model-info` panel prints, so the footer and that command can never disagree,
 * and showing it costs no request.
 *
 * This number is a REFERENCE for choosing a model; it is never used for accounting. The billed cost
 * is always `usage.cost_rub` (see pricing.ts). Non-RUB pricing stays unknown: no FX conversion.
 */
import type { ResolvedModel } from "./metadata/types.ts";

export interface ModelPrice {
  /** RUB per 1M input (prompt) tokens; null when Polza did not publish it. */
  input: number | null;
  /** RUB per 1M output (completion) tokens; null when Polza did not publish it. */
  output: number | null;
}

/**
 * Price of exactly this model id from the registry. No prefix or fuzzy matching: a model that is not
 * in the catalog has no price (the footer omits the segment instead of inventing one).
 */
export function priceFromRegistry(registry: readonly ResolvedModel[], modelId: string): ModelPrice | null {
  const model = registry.find((entry) => entry.id === modelId);
  if (!model) return null;
  const { promptPerMillion, completionPerMillion } = model.pricing.polzaRUB;
  if (promptPerMillion === null && completionPerMillion === null) return null;
  return { input: promptPerMillion, output: completionPerMillion };
}
