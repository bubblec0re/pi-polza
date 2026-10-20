/**
 * Per-model catalog price in native RUB (per 1 000 000 tokens).
 *
 * Two sources, one shape:
 *   1. the in-memory registry (`ResolvedModel.pricing.polzaRUB`), filled from the Polza catalog that
 *      Pi fetches at every start — zero runtime requests;
 *   2. `GET /api/v1/models/{id}` — a single model, used when the registry has nothing for it or the
 *      cached value is older than the footer TTL.
 *
 * This number is a REFERENCE for choosing a model; it is never used for accounting. The billed cost
 * is always `usage.cost_rub` (see pricing.ts). Non-RUB pricing stays unknown: no FX conversion.
 */
import { toNumber } from "./catalog.ts";
import { hasPolzaApiKey } from "./env.ts";
import { POLZA_API_V1, PolzaHttpError, hasRuntimePolzaApiKey, polzaJson } from "./http.ts";
import type { ResolvedModel } from "./metadata/types.ts";

export interface ModelPrice {
  /** RUB per 1M input (prompt) tokens; null when Polza did not publish it. */
  input: number | null;
  /** RUB per 1M output (completion) tokens; null when Polza did not publish it. */
  output: number | null;
}

/** The subset of Polza's pricing block this module understands. */
export interface PolzaPricingShape {
  currency?: unknown;
  prompt_per_million?: unknown;
  completion_per_million?: unknown;
}

/** The subset of `GET /api/v1/models/{id}` this module understands. */
export interface PolzaModelDetail {
  id?: unknown;
  top_provider?: { pricing?: PolzaPricingShape | null } | null;
}

function toRate(value: unknown): number | null {
  // `Number("")` is 0: an absent price must never look like a free one.
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = toNumber(value);
  return parsed === undefined || parsed < 0 ? null : parsed;
}

/**
 * Normalize a Polza pricing block. Prices arrive as decimal strings.
 * With `requireRub`, a pricing block that explicitly declares another currency is treated as unknown
 * instead of being shown as if it were RUB.
 */
export function priceFromPricing(
  pricing: PolzaPricingShape | null | undefined,
  options: { requireRub?: boolean } = {},
): ModelPrice | null {
  if (!pricing) return null;
  if (options.requireRub && typeof pricing.currency === "string" && pricing.currency.toUpperCase() !== "RUB") {
    return null;
  }
  const input = toRate(pricing.prompt_per_million);
  const output = toRate(pricing.completion_per_million);
  if (input === null && output === null) return null;
  return { input, output };
}

/** Price from the internal registry, which is refreshed with the catalog at every start. */
export function priceFromRegistry(registry: readonly ResolvedModel[], modelId: string): ModelPrice | null {
  const model = registry.find((entry) => entry.id === modelId);
  if (!model) return null;
  const { promptPerMillion, completionPerMillion } = model.pricing.polzaRUB;
  if (promptPerMillion === null && completionPerMillion === null) return null;
  return { input: promptPerMillion, output: completionPerMillion };
}

/**
 * JSON GET for the pricing endpoints. The per-model route is public, so a process without an
 * installed credential (CLI probe, cold start before `/login`) still gets an answer instead of
 * failing the footer.
 */
async function getPricingJson(path: string, signal?: AbortSignal): Promise<unknown> {
  if (hasRuntimePolzaApiKey() || hasPolzaApiKey()) {
    return polzaJson<unknown>(path, { signal });
  }
  const response = await fetch(`${POLZA_API_V1}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new PolzaHttpError(response.status, text, path);
  return text ? (JSON.parse(text) as unknown) : undefined;
}

/** Current price of one model, straight from Polza. Null when Polza has no RUB price for it. */
export async function fetchModelPrice(modelId: string, signal?: AbortSignal): Promise<ModelPrice | null> {
  const payload = await getPricingJson(`/models/${encodeURIComponent(modelId)}`, signal);
  const detail = (payload ?? null) as PolzaModelDetail | null;
  return priceFromPricing(detail?.top_provider?.pricing, { requireRub: true });
}
