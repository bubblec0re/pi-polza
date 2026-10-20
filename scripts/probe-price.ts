/**
 * Diagnostic probe for per-model pricing (the source of the footer price).
 *
 * Answers three questions with live data:
 *   1. Does `GET /api/v1/models/{id}` exist for the ids Pi actually uses, how big/fast is it,
 *      and is its `top_provider.pricing` identical to the paginated catalog?
 *   2. How does an unknown id behave (so the footer can treat it as "unknown", never 0)?
 *   3. What magnitudes must the footer formatter survive (min/median/max ₽ per 1M tokens)?
 *
 * Run: npm run probe:price            (default sample set)
 *      npm run probe:price -- <id>…
 *
 * The endpoints are public (no Authorization header is sent unless the probe is run inside a
 * process that already installed a runtime key), so this never prints or depends on the secret.
 */
import { POLZA_API_V1, toNumberSafe } from "../.pi/extensions/pi-polza/http.ts";

interface Pricing {
  currency?: unknown;
  prompt_per_million?: unknown;
  completion_per_million?: unknown;
  input_cache_read_per_million?: unknown;
}

interface ProviderEntry {
  name?: unknown;
  pricing?: Pricing;
}

interface ModelDetail {
  id?: unknown;
  top_provider?: { name?: unknown; pricing?: Pricing } | null;
  providers?: ProviderEntry[] | null;
}

interface CatalogPage {
  data?: Array<{ id?: unknown; top_provider?: { pricing?: Pricing } | null }>;
  meta?: { total?: number };
}

const DEFAULT_IDS = [
  "anthropic/claude-haiku-5.5",
  "z-ai/glm-5.3",
  "deepseek/deepseek-v4.1-flash-1017",
  "aion-labs/aion-2.0",
  "openai/gpt-6-luna-pro",
];

const MISSING_ID = "nonexistent/probe-does-not-exist";

async function getJson(path: string): Promise<{ status: number; ms: number; bytes: number; body: unknown }> {
  const url = `${POLZA_API_V1}${path}`;
  const startedAt = performance.now();
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  const ms = performance.now() - startedAt;
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { nonJson: text.slice(0, 120) };
  }
  return { status: response.status, ms, bytes: text.length, body };
}

function rate(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = toNumberSafe(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function showRate(value: number | null): string {
  return value === null ? "—" : value.toFixed(6);
}

async function probeOne(id: string): Promise<void> {
  const detail = await getJson(`/models/${encodeURIComponent(id)}`);
  if (detail.status !== 200) {
    console.log(`${id}: HTTP ${detail.status} (${detail.bytes} B) — treated as unknown`);
    return;
  }

  const model = detail.body as ModelDetail;
  const top = model.top_provider ?? null;
  const pricing = top?.pricing ?? {};
  const inRate = rate(pricing.prompt_per_million);
  const outRate = rate(pricing.completion_per_million);
  const cacheRate = rate(pricing.input_cache_read_per_million);
  const providers = Array.isArray(model.providers) ? model.providers : [];

  console.log(
    `${id}\n  models/{id}: ${detail.ms.toFixed(0)} ms, ${detail.bytes} B, provider "${String(top?.name ?? "?")}"` +
      `\n  pricing: in ${showRate(inRate)} / out ${showRate(outRate)} / cache-read ${showRate(cacheRate)} ${String(pricing.currency ?? "?")} per 1M`,
  );

  // Same model through the paginated catalog, to prove both surfaces agree.
  const catalog = await getJson(`/models/catalog?search=${encodeURIComponent(id)}&limit=100`);
  const page = catalog.body as CatalogPage;
  const entry = (page.data ?? []).find((candidate) => candidate.id === id);
  const catalogPricing = entry?.top_provider?.pricing ?? null;
  const same =
    catalogPricing !== null &&
    rate(catalogPricing.prompt_per_million) === inRate &&
    rate(catalogPricing.completion_per_million) === outRate;
  console.log(
    `  catalog:    ${catalog.ms.toFixed(0)} ms, ${catalog.bytes} B, ${page.data?.length ?? 0} hits` +
      ` — ${entry ? (same ? "pricing identical" : "PRICING DIFFERS") : "exact id not returned"}`,
  );

  if (providers.length > 0) {
    const rates = providers
      .map((entry) => rate(entry.pricing?.prompt_per_million))
      .filter((value): value is number => value !== null);
    const cheapest = Math.min(...rates);
    const dearest = Math.max(...rates);
    console.log(
      `  providers:  ${providers.length} routes, prompt ₽/1M from ${showRate(cheapest)} to ${showRate(dearest)}` +
        (cheapest !== dearest ? "  ← the catalog number is one route, not all of them" : ""),
    );
  }
}

async function probeMissing(): Promise<void> {
  const result = await getJson(`/models/${encodeURIComponent(MISSING_ID)}`);
  const body = result.body as { error?: { code?: unknown } } | null;
  console.log(
    `unknown id: HTTP ${result.status} (${result.bytes} B), code ${String(body?.error?.code ?? "?")} → footer shows no price, never 0`,
  );
}

async function probeMagnitudes(): Promise<void> {
  const list = await getJson("/models");
  if (list.status !== 200) {
    console.log(`/models: HTTP ${list.status} — skipping magnitude table`);
    return;
  }
  const models = ((list.body as { data?: unknown }).data ?? []) as Array<{ top_provider?: { pricing?: Pricing } | null }>;
  const inputRates: number[] = [];
  const outputRates: number[] = [];
  for (const model of models) {
    const pricing = model.top_provider?.pricing ?? {};
    const input = rate(pricing.prompt_per_million);
    const output = rate(pricing.completion_per_million);
    if (input !== null) inputRates.push(input);
    if (output !== null) outputRates.push(output);
  }
  inputRates.sort((a, b) => a - b);
  outputRates.sort((a, b) => a - b);
  const at = (values: number[], share: number): number => values[Math.min(values.length - 1, Math.floor(values.length * share))]!;
  console.log(
    `\nprice magnitudes (${list.ms.toFixed(0)} ms, ${list.bytes} B, ${models.length} models):` +
      `\n  input  ₽/1M: min ${showRate(inputRates[0] ?? null)}, p10 ${showRate(at(inputRates, 0.1))}, median ${showRate(at(inputRates, 0.5))}, p90 ${showRate(at(inputRates, 0.9))}, max ${showRate(inputRates.at(-1) ?? null)}` +
      `\n  output ₽/1M: min ${showRate(outputRates[0] ?? null)}, median ${showRate(at(outputRates, 0.5))}, max ${showRate(outputRates.at(-1) ?? null)}` +
      `\n  → the footer needs adaptive precision, a fixed 2-decimal format would render cheap models as 0.00`,
  );
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  console.log("Per-model pricing probe (public endpoints, native RUB)\n");
  for (const id of ids.length > 0 ? ids : DEFAULT_IDS) {
    await probeOne(id);
    console.log("");
  }
  await probeMissing();
  await probeMagnitudes();
}

main().catch((error) => {
  console.error("probe-price failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
