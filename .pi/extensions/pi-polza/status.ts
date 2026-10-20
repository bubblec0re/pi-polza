/**
 * Persistent Polza footer/status bar (framework-agnostic core).
 *
 * Renders `Polza <balance> ₽ | Spent <cost> ₽ | (X in / Y out ₽/1M)` via Pi's native
 * `ctx.ui.setStatus`. Balance comes from `/api/v2/balance`; Spent is the sum of authoritative
 * `usage.cost_rub`; the price is the catalog reference rate of the selected model.
 * The three are independent: a failing endpoint never hides the other values.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { splitStatusLine, type WidthMeasure } from "./align.ts";
import type { PolzaBalance } from "./balance.ts";
import type { PolzaPricingRUB } from "./metadata/types.ts";

/** Minimal theme surface the footer needs (keeps this module free of TUI internals). */
export type StatusTheme = Pick<Theme, "fg" | "bold">;

/** Key under which the status text is registered with Pi. */
export const POLZA_STATUS_KEY = "polza-accounting";

/** Balance is re-fetched at most this often (during activation / after a completed request). */
export const BALANCE_TTL_MS = 45_000;

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

/** Price state: `fresh` = read from the catalog registry, `unknown` = the model publishes no price. */
export type PriceState = "fresh" | "unknown";

export interface PriceSnapshot {
  /** Model the price belongs to; a snapshot for another model must never be rendered. */
  modelId: string;
  /** The catalog record itself (`ResolvedModel.pricing.polzaRUB`) — no copies, no re-parsing. */
  price: PolzaPricingRUB | null;
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
  const input = formatPricePerMillion(snapshot.price.promptPerMillion);
  const output = formatPricePerMillion(snapshot.price.completionPerMillion);
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
/** How to place the two halves of the line. Without it the halves are simply joined by ` | `. */
export interface StatusLayout {
  /** Usable width of the status line (terminal columns). */
  columns: number;
  /** ANSI-aware width measurement (`visibleWidth` in the runtime, plain length in tests). */
  measure: WidthMeasure;
}

/**
 * Left half: `Polza <balance> ₽ | Spent <cost> ₽`. Account state and what this session actually cost —
 * the numbers that must stay readable at a glance.
 */
export function renderStatusAccount(theme: StatusTheme, model: PolzaStatusModel): string {
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
  ].join("");
}

/** Right half: `(11.74 in / 58.72 out ₽/1M)`, or null when the price is unknown. */
export function renderStatusPrice(theme: StatusTheme, model: PolzaStatusModel): string | null {
  if (!model.price) return null;
  return [
    theme.fg("muted", "("),
    theme.fg("text", model.price.input),
    theme.fg("muted", " in / "),
    theme.fg("text", model.price.output),
    theme.fg("muted", " out ₽/1M)"),
  ].join("");
}

/**
 * One status string: account and spend on the left, the model's catalog price on the right edge.
 * With a layout the halves are separated by a gap that survives Pi's status sanitizer; without one
 * (tests, plain-text callers) they are joined by ` | `.
 */
export function renderPolzaStatus(theme: StatusTheme, model: PolzaStatusModel, layout?: StatusLayout): string {
  const left = renderStatusAccount(theme, model);
  const price = renderStatusPrice(theme, model);
  if (!price) return left;
  if (layout) return splitStatusLine(left, price, layout.columns, layout.measure);
  return `${left}${theme.fg("dim", " | ")}${price}`;
}

export interface StatusControllerDeps {
  /** Called with the structured footer model, or undefined to clear. */
  setStatus: (model: PolzaStatusModel | undefined) => void;
  fetchBalance: (signal?: AbortSignal) => Promise<PolzaBalance>;
  getSessionCost: () => SessionCost;
  /** Model currently selected in Pi, or null when it is not a Polza model. */
  getActiveModelId?: () => string | null;
  /**
   * The model's catalog pricing record — the very same `ResolvedModel.pricing.polzaRUB` that
   * `/polza-model-info` prints. No request is made for it and nothing is copied.
   */
  getModelPricing?: (modelId: string) => PolzaPricingRUB | null;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Owns the balance cache and the price snapshot. Rendering is a pure function of
 * the caches and the session accumulator, so it is cheap to call after every billed request.
 */
export class PolzaStatusController {
  private balance: BalanceSnapshot = { value: null, fetchedAt: 0, state: "unavailable" };
  private lastBalance: PolzaBalance | null = null;
  private price: PriceSnapshot | null = null;
  private active = false;
  private refreshing = false;
  private readonly deps: StatusControllerDeps;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(deps: StatusControllerDeps) {
    this.deps = deps;
    this.ttlMs = deps.ttlMs ?? BALANCE_TTL_MS;
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
   * Show the status for the Polza provider. The price is read from the catalog registry (no request);
   * only the balance has a TTL and a live refresh.
   */
  activate(signal?: AbortSignal): void {
    this.active = true;
    this.syncPrice();
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

  /** The catalog registry was rebuilt (startup fetch / `/polza-refresh`): re-read the price. */
  catalogUpdated(): void {
    this.syncPrice(true);
    this.render();
  }

  /** Re-render with the current state (e.g. terminal resize changed the usable width). */
  refresh(): void {
    this.render();
  }

  /** Called after a response was accounted: re-render now, refresh the balance when its TTL expired. */
  requestCompleted(signal?: AbortSignal): void {
    if (!this.active) return;
    this.syncPrice();
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

  private currentModelId(): string | null {
    try {
      return this.deps.getActiveModelId?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Point the snapshot at the currently selected model and read its price from the catalog registry.
   *
   * There is deliberately no price request here: the registry already holds Polza's catalog prices
   * (fetched at every Pi start and by `/polza-refresh`), and it is the same `pricing.polzaRUB` the
   * `/polza-model-info` panel prints. One source, one number, no extra traffic.
   */
  private syncPrice(force = false): void {
    const modelId = this.currentModelId();
    if (modelId === null) {
      this.price = null;
      return;
    }
    if (!force && this.price?.modelId === modelId) return;

    const catalog = this.deps.getModelPricing?.(modelId) ?? null;
    this.price = catalog
      ? { modelId, price: catalog, fetchedAt: this.now(), state: "fresh" }
      : { modelId, price: null, fetchedAt: 0, state: "unknown" };
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
