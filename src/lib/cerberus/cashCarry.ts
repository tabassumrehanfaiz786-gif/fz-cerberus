export const STARTING_CAPITAL = 100_000;
export const MAX_POSITIONS = 10;
export const MAX_UNIVERSE = 50;
export const YEAR_HOURS = 365 * 24;
export type CarrySettings = { feeBps: number; slippageBps: number; dragApr: number; horizonDays: number; minVolume: number; minNetApr: number; treasuryApr: number };
export const DEFAULT_SETTINGS: CarrySettings = { feeBps: 10, slippageBps: 2, dragApr: 1, horizonDays: 30, minVolume: 5_000_000, minNetApr: 0, treasuryApr: 4 };
export type CarryMarket = { symbol: string; asset: string; spotBid: number; spotAsk: number; perpBid: number; perpAsk: number; mark: number; funding: number; intervalHours: number; nextFunding: number; volume: number; ts: number };
export function fundingApr(rate: number, intervalHours: number) { return intervalHours > 0 ? rate * YEAR_HOURS / intervalHours * 100 : 0; }
export function indicativeApy(rate: number, intervalHours: number) { return intervalHours > 0 && rate > -1 ? Math.expm1(Math.log1p(rate) * YEAR_HOURS / intervalHours) * 100 : 0; }
export function roundTripCost(notional: number, settings: CarrySettings) { return notional * 4 * (settings.feeBps + settings.slippageBps) / 10_000; }
// Two dollars committed per dollar of spot: fully funded spot plus 1x short collateral.
export function netCarryApr(m: CarryMarket, s: CarrySettings) {
  const costApr = 4 * (s.feeBps + s.slippageBps) / 10_000 * 365 / s.horizonDays * 100;
  return (fundingApr(m.funding, m.intervalHours) - costApr - s.dragApr) / 2;
}
export function isFresh(m: CarryMarket, now: number) { return now - m.ts < 30_000 && now >= m.ts && m.spotBid > 0 && m.spotAsk >= m.spotBid && m.perpBid > 0 && m.perpAsk >= m.perpBid && m.mark > 0 && m.nextFunding > now; }
export function rankCandidates(markets: CarryMarket[], s: CarrySettings, now: number) {
  return markets.filter(m => isFresh(m, now) && m.funding > 0 && m.volume >= s.minVolume && netCarryApr(m, s) > s.minNetApr)
    .sort((a, b) => netCarryApr(b, s) - netCarryApr(a, s)).filter((m, i, a) => a.findIndex(x => x.asset === m.asset) === i).slice(0, MAX_POSITIONS);
}
export type CarryPosition = { id: number; symbol: string; asset: string; qty: number; entrySpot: number; entryPerp: number; collateral: number; opened: number; lastSettlement: number; fundingPaid: number; fees: number; entryCostBps: number; dragApr: number; benchmarkQty: number };
export function positionPnl(p: CarryPosition, m: CarryMarket) { return p.qty * ((m.spotBid - p.entrySpot) + (p.entryPerp - m.perpAsk)); }
export function dollarDelta(p: CarryPosition, m: CarryMarket) { return p.qty * ((m.spotBid + m.spotAsk) / 2 - m.mark); }
export function marginHealth(p: CarryPosition, m: CarryMarket, shock = 0) {
  const stressed = m.mark * (1 + shock / 100);
  const equity = p.collateral + p.qty * (p.entryPerp - stressed) + p.fundingPaid;
  const maintenance = p.qty * stressed * 0.01;
  return { equity, maintenance, buffer: equity - maintenance, ratio: maintenance > 0 ? equity / maintenance : 0 };
}
export function stressPnl(p: CarryPosition, m: CarryMarket, shock: number, basisShockBps: number) {
  const spot = m.spotBid * (1 + shock / 100);
  const perp = m.perpAsk * (1 + shock / 100) * (1 + basisShockBps / 10_000);
  return p.qty * ((spot - p.entrySpot) + (p.entryPerp - perp));
}