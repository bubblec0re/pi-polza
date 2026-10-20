/**
 * Persistent Polza footer/status bar (framework-agnostic core).
 *
 * Renders `Polza <balance> ₽ | Spent <cost> ₽ | (X in / Y out ₽/1M)` via Pi's native
 * `ctx.ui.setStatus`. Balance comes from `/api/v2/balance`; Spent is the sum of authoritative
 * `usage.cost_rub`; the price is the catalog reference rate of the selected model.
 * The three are independent: a failing endpoint never hides the other values.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PolzaBalance } from "./balance.ts";
import type { ModelPrice } from "./model-price.ts";

/** Minimal theme surface the footer needs (keeps this module free of TUI internals). */
export type StatusTheme = Pick<Theme, "fg" | "bold">;

/** Key under which the status text is registered with Pi. */
export const POLZA_STATUS_KEY = "polza-accounting";

/** Balance is re-fetched at most this often (during activation / after a completed request). */
export const BALANCE_TTL_MS = 45_000;

/**
 * Price is re-fetched at most this often. Catalog RUB prices drift slowly (≈0.2 % per month, they look
 * FX-derived), so an hour is already generous; there is no timer, only a check on activation/model change.
 */
export const PRICE_TTL_MS = 60 * 60 * 1000;

/** After a failed price request, wait this long before trying the same model again. */
export const PRICE_RETRY_MS = 5 * 60 * 1000;

export type BalanceState = "fresh" | "stale" | "unavailable";

export interface BalanceSnapshot {
  /** Available balance in RUB; null when never successfully fetched. */
  value: number | null;
  fetchedAt: number;
  state: BalanceState;
}

export interface SessionCost {
  requests: number;
  /** Sum of `usage.cost_rub`; null when records exist but none carried a cost. */
  costRub: number | null;
  /** Requests whose cost is unknown; > 0 makes the footer mark the subtotal as partial. */
  unpricedRequests?: number;
}

/** Compact RUB: 2 decimals for normal amounts, more precision only when the amount is tiny. */
export function formatRubCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "?";
  const abs = Math.abs(value);
  if (abs === 0) return "0.00 ₽";
  if (abs >= 0.1) return `${value.toFixed(2)} ₽`;
  if (abs >= 0.001) return `${value.toFixed(4)} ₽`;
  return `${value.toFixed(6)} ₽`;
}

/**
 * RUB per 1M tokens. Adaptive precision: catalog prices span 0.46 → 70 460 ₽/1M, so a fixed two
 * decimals would print cheap models as `0.00` and wide ones with four useless digits.
 */
export function formatPricePerMillion(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value >= 1000) return String(Math.round(value));
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.1) return value.toFixed(3);
  return value.toFixed(4);
}

/** Price state: `unknown` = never obtained, `stale` = last known value survived a failed refresh. */
export type PriceState = "fresh" | "stale" | "unknown";

export interface PriceSnapshot {
  /** Model the price belongs to; a snapshot for another model must never be rendered. */
  modelId: string;
  price: ModelPrice | null;
  fetchedAt: number;
  state: PriceState;
}

function balanceCell(balance: BalanceSnapshot): string {
  if (balance.value === null) return "?";
  return formatRubCompact(balance.value);
}

function sessionCell(session: SessionCost): string {
  if (session.requests === 0) return formatRubCompact(0);
  return formatRubCompact(session.costRub);
}

/** `Polza 43.54 ₽ | Spent 0.61 ₽` (or `Polza ? ₽ | Spent 0.61 ₽` on balance failure). */
export function formatBalanceStatus(
  balance: BalanceSnapshot,
  session: SessionCost,
  price: PriceSnapshot | null = null,
): string {
  return renderPolzaStatus(PLAIN_STATUS_THEME, polzaStatusModel(balance, session, price));
}

/** Structured footer content, so the caller can theme it without parsing a string. */
export interface PolzaStatusModel {
  balance: string;
  session: string;
  balanceState: BalanceState;
  /** True when some requests had no authoritative cost, so the spend is a partial subtotal. */
  partial: boolean;
  /** Catalog price of the selected model, already formatted; null = unknown (segment omitted). */
  price: { input: string; output: string } | null;
  priceState: PriceState;
}

/**
 * Turn a price snapshot into the footer values. Both sides are shown, or the segment is omitted:
 * a one-sided price would read as if the other half were free.
 */
function priceCell(snapshot: PriceSnapshot | null | undefined): { input: string; output: string } | null {
  if (!snapshot || !snapshot.price) return null;
  const input = formatPricePerMillion(snapshot.price.input);
  const output = formatPricePerMillion(snapshot.price.output);
  if (input === null || output === null) return null;
  return { input, output };
}

export function polzaStatusModel(
  balance: BalanceSnapshot,
  session: SessionCost,
  price: PriceSnapshot | null = null,
): PolzaStatusModel {
  return {
    balance: balanceCell(balance),
    session: sessionCell(session),
    balanceState: balance.state,
    partial: (session.unpricedRequests ?? 0) > 0,
    price: priceCell(price),
    priceState: price?.state ?? "unknown",
  };
}

/** No-op theme used for plain-text output (tests, non-TUI fallback). */
export const PLAIN_STATUS_THEME: StatusTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

/**
 * Calm, low-noise styling: labels are muted, the separator is dim, values are normal text.
 * Unavailable balance and the stale marker use warning, never the whole line.
 * The `partial` marker is deliberately faint: it qualifies the number without competing with it.
 */
export function renderPolzaStatus(theme: StatusTheme, model: PolzaStatusModel): string {
  const balanceValue =
    model.balanceState === "unavailable" ? theme.fg("warning", model.balance) : theme.fg("text", model.balance);
  return [
    theme.fg("muted", "Polza"),
    " ",
    balanceValue,
    ...(model.balanceState === "stale" ? [" ", theme.fg("warning", "stale")] : []),
    theme.fg("dim", " | "),
    theme.fg("muted", "Spent"),
    " ",
    theme.fg("text", model.session),
    ...(model.partial ? [" ", theme.fg("dim", "partial")] : []),
    ...(model.price
      ? [
          theme.fg("dim", " | "),
          theme.fg("muted", "("),
          theme.fg("text", model.price.input),
          theme.fg("muted", " in / "),
          theme.fg("text", model.price.output),
          theme.fg("muted", " out ₽/1M)"),
        ]
      : []),
  ].join("");
}

export interface StatusControllerDeps {
  /** Called with the structured footer model, or undefined to clear. */
  setStatus: (model: PolzaStatusModel | undefined) => void;
  fetchBalance: (signal?: AbortSignal) => Promise<PolzaBalance>;
  getSessionCost: () => SessionCost;
  /** Model currently selected in Pi, or null when it is not a Polza model. */
  getActiveModelId?: () => string | null;
  /** Price already known from the in-memory catalog registry (no request). */
  getCatalogPrice?: (modelId: string) => ModelPrice | null;
  /** Live price for one model, used when the registry has nothing or the value expired. */
  fetchPrice?: (modelId: string, signal?: AbortSignal) => Promise<ModelPrice | null>;
  ttlMs?: number;
  /** Separate, longer TTL for prices (catalog RUB rates drift slowly). */
  priceTtlMs?: number;
  now?: () => number;
}

/**
 * Owns the balance and price caches and decides when to (re)fetch. Rendering is a pure function of
 * the caches and the session accumulator, so it is cheap to call after every billed request.
 */
export class PolzaStatusController {
  private balance: BalanceSnapshot = { value: null, fetchedAt: 0, state: "unavailable" };
  private lastBalance: PolzaBalance | null = null;
  private price: PriceSnapshot | null = null;
  /** Last fetch attempt per model, so a failing endpoint is not retried on every render. */
  private priceAttempt: { modelId: string; at: number } | null = null;
  private active = false;
  private refreshing = false;
  private refreshingPrice = false;
  private readonly deps: StatusControllerDeps;
  private readonly ttlMs: number;
  private readonly priceTtlMs: number;
  private readonly now: () => number;

  constructor(deps: StatusControllerDeps) {
    this.deps = deps;
    this.ttlMs = deps.ttlMs ?? BALANCE_TTL_MS;
    this.priceTtlMs = deps.priceTtlMs ?? PRICE_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  get snapshot(): BalanceSnapshot {
    return this.balance;
  }

  /** Last price snapshot, for tests and diagnostics. Never rendered for a different model. */
  get priceSnapshot(): PriceSnapshot | null {
    return this.price;
  }

  /** Last successfully fetched balance payload (for the detailed `/polza-balance` view). */
  get current(): PolzaBalance | null {
    return this.lastBalance;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Show the status for the Polza provider. Seeds the price from the registry (free), refreshes the
   * balance and the price only when their TTLs expired.
   */
  activate(signal?: AbortSignal): void {
    this.active = true;
    this.syncPrice(signal);
    this.render();
    if (this.isStale()) void this.refreshBalance(signal);
  }

  /** Hide the status (provider switched away, or non-TUI mode). */
  deactivate(): void {
    this.active = false;
    this.deps.setStatus(undefined);
  }

  /**
   * The model changed: a snapshot belonging to the previous model must never be shown, so the price is
   * re-seeded from the registry (or cleared) before rendering.
   */
  modelChanged(signal?: AbortSignal): void {
    this.activate(signal);
  }

  /** The catalog registry was rebuilt (startup fetch / `/polza-refresh`): re-seed prices for free. */
  catalogUpdated(): void {
    this.syncPrice();
    this.render();
  }

  /** Re-render with the current state (e.g. terminal resize changed the usable width). */
  refresh(): void {
    this.render();
  }

  /** Called after a response was accounted: re-render now, refresh only when a TTL expired. */
  requestCompleted(signal?: AbortSignal): void {
    if (!this.active) return;
    this.syncPrice(signal);
    this.render();
    if (this.isStale()) void this.refreshBalance(signal);
  }

  /** Force a balance refresh (used by `/polza-balance`), bypassing the TTL. */
  async refreshBalance(signal?: AbortSignal): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const balance = await this.deps.fetchBalance(signal);
      this.lastBalance = balance;
      this.balance = { value: balance.available, fetchedAt: this.now(), state: "fresh" };
    } catch {
      // Keep the last known value; distinguish stale (had one) from unavailable (never had one).
      this.balance = {
        value: this.balance.value,
        fetchedAt: this.balance.fetchedAt,
        state: this.balance.value === null ? "unavailable" : "stale",
      };
    } finally {
      this.refreshing = false;
    }
    this.render();
  }

  private isStale(): boolean {
    return this.now() - this.balance.fetchedAt >= this.ttlMs;
  }

  private isPriceStale(): boolean {
    if (!this.price || !this.price.price) return true;
    if (this.price.modelId !== this.currentModelId()) return true;
    return this.now() - this.price.fetchedAt >= this.priceTtlMs;
  }

  private currentModelId(): string | null {
    try {
      return this.deps.getActiveModelId?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Point the snapshot at the currently selected model: reuse a fresh value for the same model, else
   * take the catalog registry value, else mark it unknown. Schedules a live refresh when needed.
   */
  private syncPrice(signal?: AbortSignal): void {
    const modelId = this.currentModelId();
    if (modelId === null) {
      this.price = null;
      return;
    }

    const sameModel = this.price?.modelId === modelId;
    if (!sameModel || !this.price?.price) {
      const catalog = this.deps.getCatalogPrice?.(modelId) ?? null;
      this.price = catalog
        ? { modelId, price: catalog, fetchedAt: this.now(), state: "fresh" }
        : { modelId, price: null, fetchedAt: 0, state: "unknown" };
    }

    if (this.shouldFetchPrice()) void this.refreshPrice(signal);
  }

  /** Whether a live price request is due: stale value, no recent failed attempt, nothing in flight. */
  private shouldFetchPrice(): boolean {
    const modelId = this.currentModelId();
    if (modelId === null || !this.deps.fetchPrice || this.refreshingPrice) return false;
    const lastAttempt = this.priceAttempt?.modelId === modelId ? this.priceAttempt.at : 0;
    if (this.now() - lastAttempt < PRICE_RETRY_MS) return false;
    return this.isPriceStale();
  }

  /** Fetch the price of the selected model; a failure keeps the last known value marked `stale`. */
  async refreshPrice(signal?: AbortSignal): Promise<void> {
    const modelId = this.currentModelId();
    if (modelId === null || !this.deps.fetchPrice || this.refreshingPrice) return;
    this.refreshingPrice = true;
    this.priceAttempt = { modelId, at: this.now() };
    try {
      const price = await this.deps.fetchPrice(modelId, signal);
      // The model may have changed while the request was in flight: never paint a foreign price.
      if (this.currentModelId() !== modelId) return;
      const known = this.price?.modelId === modelId ? (this.price.price ?? null) : null;
      if (price) {
        this.price = { modelId, price, fetchedAt: this.now(), state: "fresh" };
      } else {
        this.price = { modelId, price: known, fetchedAt: this.price?.fetchedAt ?? 0, state: known ? "stale" : "unknown" };
      }
    } catch {
      const known = this.price?.modelId === modelId ? (this.price.price ?? null) : null;
      this.price = { modelId, price: known, fetchedAt: this.price?.fetchedAt ?? 0, state: known ? "stale" : "unknown" };
    } finally {
      this.refreshingPrice = false;
    }
    this.render();
  }

  private render(): void {
    if (!this.active) {
      this.deps.setStatus(undefined);
      return;
    }
    const modelId = this.currentModelId();
    const price = modelId !== null && this.price?.modelId === modelId ? this.price : null;
    this.deps.setStatus(polzaStatusModel(this.balance, this.deps.getSessionCost(), price));
  }
}
