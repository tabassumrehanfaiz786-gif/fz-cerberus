import { describe, it, expect } from 'vitest';
import { preTradeCheck, rollingDrawdownPct, packageMarkoutBps, markoutSummary, performance, parseOkxFunding, DEFAULT_LIMITS } from '@/lib/cerberus/institutional';

describe('pre-trade limits', () => {
  it('rejects allocation above the $15,000 per-asset cap', () => expect(preTradeCheck(15_001, 0, 100_000, DEFAULT_LIMITS).ok).toBe(false));
  it('rejects gross leverage above 1x', () => expect(preTradeCheck(10_000, 95_000, 100_000, DEFAULT_LIMITS).ok).toBe(false));
  it('accepts a compliant allocation', () => expect(preTradeCheck(10_000, 50_000, 100_000, DEFAULT_LIMITS).ok).toBe(true));
});
describe('drawdown breaker', () => {
  it('measures drawdown only inside the window', () => {
    const pts = [{ ts: 0, net: 200_000 }, { ts: 3_600_000, net: 100_000 }, { ts: 3_700_000, net: 97_000 }];
    expect(rollingDrawdownPct(pts, 3_700_000, 60)).toBeCloseTo(3);
  });
});
describe('markouts', () => {
  it('scores adverse basis widening as negative bps', () => expect(packageMarkoutBps(100, 100, 100, 100.1)).toBeCloseTo(-10));
  it('summarises adverse share', () => {
    const s = markoutSummary([{ id: 1, asset: 'A', symbol: 'A', ts: 0, entrySpot: 1, entryPerp: 1, values: { 5: -2 } }, { id: 2, asset: 'B', symbol: 'B', ts: 0, entrySpot: 1, entryPerp: 1, values: { 5: 4 } }]);
    expect(s.find(x => x.horizon === 5)).toMatchObject({ n: 2, meanBps: 1, adversePct: 50 });
  });
});
describe('performance', () => {
  it('computes max drawdown', () => expect(performance([100, 110, 99, 105], 5).maxDrawdownPct).toBeCloseTo(10));
});
describe('OKX funding parse', () => {
  it('derives asset and 4h interval', () => {
    const m = parseOkxFunding([{ instId: 'BTC-USDT-SWAP', fundingRate: '0.0001', fundingTime: '0', nextFundingTime: String(4 * 3_600_000) }, { instId: 'BTC-USD-SWAP', fundingRate: '1' }]);
    expect(m.get('BTC')).toEqual({ asset: 'BTC', rate: 0.0001, intervalHours: 4 });
    expect(m.size).toBe(1);
  });
});
