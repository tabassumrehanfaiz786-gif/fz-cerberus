// Pure institutional-style helpers: pre-trade limits, post-trade markouts, session performance, cross-venue funding.
export type RiskLimits = { maxPositionUsd: number; maxGrossLeverage: number; maxDrawdownPct: number; drawdownWindowMin: number };
export const DEFAULT_LIMITS: RiskLimits = { maxPositionUsd: 15_000, maxGrossLeverage: 1, maxDrawdownPct: 2, drawdownWindowMin: 60 };

/** Pre-trade check for a new hedge package. Gross = committed capital (spot + short collateral) / equity. */
export function preTradeCheck(allocation: number, committed: number, equity: number, limits: RiskLimits): { ok: true } | { ok: false; reason: string } {
  if (!(equity > 0)) return { ok: false, reason: 'Non-positive equity' };
  if (allocation > limits.maxPositionUsd) return { ok: false, reason: `Allocation ${allocation.toFixed(0)} exceeds per-asset cap ${limits.maxPositionUsd}` };
  if ((committed + allocation) / equity > limits.maxGrossLeverage) return { ok: false, reason: `Gross leverage would exceed ${limits.maxGrossLeverage}x` };
  return { ok: true };
}

/** Peak-to-current drawdown (%) inside the trailing window. */
export function rollingDrawdownPct(points: { ts: number; net: number }[], now: number, windowMin: number) {
  const from = now - windowMin * 60_000;
  let peak = -Infinity, last = NaN;
  for (const p of points) if (p.ts >= from) { peak = Math.max(peak, p.net); last = p.net; }
  return peak > 0 && Number.isFinite(last) ? Math.max(0, (peak - last) / peak * 100) : 0;
}

export const MARKOUT_HORIZONS = [1, 5, 15, 60] as const;
export type Markout = { id: number; asset: string; symbol: string; ts: number; entrySpot: number; entryPerp: number; values: Partial<Record<(typeof MARKOUT_HORIZONS)[number], number>> };
/** Long-spot / short-perp package markout in bps of entry spot. Positive = market moved in the package's favour after the fill. */
export function packageMarkoutBps(entrySpot: number, entryPerp: number, spotMid: number, perpMid: number) {
  return entrySpot > 0 ? ((spotMid - entrySpot) + (entryPerp - perpMid)) / entrySpot * 10_000 : 0;
}
export function markoutSummary(rows: Markout[]) {
  return MARKOUT_HORIZONS.map(h => {
    const v = rows.map(r => r.values[h]).filter((x): x is number => typeof x === 'number');
    const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    return { horizon: h, n: v.length, meanBps: mean, adversePct: v.length ? v.filter(x => x < 0).length / v.length * 100 : 0 };
  });
}

/** Session performance from equally spaced equity samples. Annualization is illustrative on short sessions. */
export function performance(values: number[], sampleSeconds: number) {
  const r: number[] = [];
  for (let i = 1; i < values.length; i++) { const a = values[i - 1]!, b = values[i]!; if (a > 0) r.push(b / a - 1); }
  let peak = -Infinity, mdd = 0;
  for (const v of values) { peak = Math.max(peak, v); if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak); }
  if (r.length < 2) return { sharpe: 0, sortino: 0, maxDrawdownPct: mdd * 100, calmar: 0, samples: r.length };
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  const dd = Math.sqrt(r.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / r.length);
  const k = Math.sqrt(365 * 86400 / sampleSeconds);
  const first = values[0]!, last = values.at(-1)!;
  const years = r.length * sampleSeconds / (365 * 86400);
  const annual = first > 0 && years > 0 ? (last / first - 1) / years : 0;
  return { sharpe: sd > 0 ? mean / sd * k : 0, sortino: dd > 0 ? mean / dd * k : 0, maxDrawdownPct: mdd * 100, calmar: mdd > 0 ? annual / mdd : 0, samples: r.length };
}

export type VenueFunding = { asset: string; rate: number; intervalHours: number };
/** Parses OKX public funding-rate (instId=ANY) rows for USDT linear swaps. */
export function parseOkxFunding(rows: { instId?: string; fundingRate?: string; fundingTime?: string; nextFundingTime?: string }[]): Map<string, VenueFunding> {
  const out = new Map<string, VenueFunding>();
  for (const r of rows) {
    const m = /^([A-Z0-9]+)-USDT-SWAP$/.exec(r.instId ?? ''); const rate = Number(r.fundingRate);
    const hours = (Number(r.nextFundingTime) - Number(r.fundingTime)) / 3_600_000;
    if (m?.[1] && Number.isFinite(rate)) out.set(m[1], { asset: m[1], rate, intervalHours: hours > 0 && hours <= 24 ? hours : 8 });
  }
  return out;
}
