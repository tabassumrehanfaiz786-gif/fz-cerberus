// Server-side 24/7 paper cash-and-carry runner. Public Bybit data only; no real orders.
export const CLOUD_CAPITAL = 100_000;
export const CLOUD_SLOTS = 10;
export const LEG_COST_BPS = 7; // assumed fee + slippage per leg
const MIN_TURNOVER = 20_000_000;
const STABLES = ['USDC', 'USDT', 'DAI', 'TUSD', 'FDUSD', 'USDE'];

type T = Record<string, string>;
async function bybit(path: string) {
  const r = await fetch(`https://api.bybit.com/v5/market/${path}`);
  if (!r.ok) throw new Error(`Bybit ${r.status}`);
  const j = await r.json() as { retCode: number; retMsg: string; result: { list: T[] } };
  if (j.retCode !== 0) throw new Error(j.retMsg);
  return j.result.list;
}

export async function runCloudCarry() {
  const { supabaseAdmin: db } = await import('@/integrations/supabase/client.server');
  const [spotL, perpL] = await Promise.all([bybit('tickers?category=spot'), bybit('tickers?category=linear')]);
  const spot = new Map(spotL.map(t => [t['symbol'], t]));
  const perp = new Map(perpL.map(t => [t['symbol'], t]));
  const log: { type: string; detail: string; amount?: number }[] = [];

  const { data: open = [] } = await db.from('cloud_positions').select('*').is('closed_at', null);
  const openRows = open ?? [];

  // 1. Settle funding from exchange-reported history (never invented).
  for (const p of openRows) {
    const pt = perp.get(p.symbol); if (!pt) continue;
    const mark = Number(pt['markPrice']);
    const hist = await bybit(`funding/history?category=linear&symbol=${p.symbol}&startTime=${p.last_settlement + 1}&endTime=${Date.now()}&limit=50`).catch(() => []);
    let last = p.last_settlement, cash = 0;
    for (const h of hist) { const ts = Number(h['fundingRateTimestamp']); if (ts > p.last_settlement) { cash += p.qty * mark * Number(h['fundingRate']); last = Math.max(last, ts); } }
    if (last > p.last_settlement) {
      p.funding_paid += cash; p.last_settlement = last;
      await db.from('cloud_positions').update({ funding_paid: p.funding_paid, last_settlement: last }).eq('id', p.id);
      log.push({ type: 'FUNDING', detail: `${p.asset} settled funding ${cash >= 0 ? 'received' : 'paid'} (mark-estimated)`, amount: cash });
    }
  }

  // 2. Mark and close hedges whose live funding turned negative.
  for (const p of openRows) {
    const s = spot.get(p.symbol), pt = perp.get(p.symbol); if (!s || !pt) continue;
    const sb = Number(s['bid1Price']), pa = Number(pt['ask1Price']);
    const mtm = p.qty * (sb - p.entry_spot) + p.qty * (p.entry_perp - pa);
    if (Number(pt['fundingRate']) < 0) {
      const exit = p.qty * (sb + pa) * LEG_COST_BPS / 10_000;
      await db.from('cloud_positions').update({ closed_at: new Date().toISOString(), close_reason: 'Funding turned negative', realized: mtm - exit, last_spot: sb, last_perp: pa }).eq('id', p.id);
      p.closed_at = 'now'; p.realized = mtm - exit;
      log.push({ type: 'CLOSE', detail: `${p.asset} closed: funding turned negative`, amount: mtm - exit });
    } else await db.from('cloud_positions').update({ last_spot: sb, last_perp: pa }).eq('id', p.id);
    (p as typeof p & { mtm: number }).mtm = mtm;
  }

  // 3. Open new hedges in free slots, ranked by live funding.
  const still = openRows.filter(p => !p.closed_at);
  const held = new Set(still.map(p => p.symbol));
  const ranked = perpL.filter(t => {
    const s = spot.get(t['symbol']); const base = t['symbol'].replace(/USDT$/, '');
    return t['symbol'].endsWith('USDT') && s && !STABLES.includes(base) && !held.has(t['symbol'])
      && Math.min(Number(t['turnover24h']), Number(s['turnover24h'])) > MIN_TURNOVER && Number(t['fundingRate']) > 0.00005;
  }).sort((a, b) => Number(b['fundingRate']) - Number(a['fundingRate']));
  for (const t of ranked.slice(0, Math.max(0, CLOUD_SLOTS - still.length))) {
    const s = spot.get(t['symbol'])!; const sa = Number(s['ask1Price']), pb = Number(t['bid1Price']);
    if (!(sa > 0 && pb > 0)) continue;
    const alloc = CLOUD_CAPITAL / CLOUD_SLOTS / 2; // spot + equal short collateral
    const qty = alloc / sa; const cost = qty * (sa + pb) * LEG_COST_BPS / 10_000;
    const asset = t['symbol'].replace(/USDT$/, '');
    await db.from('cloud_positions').insert({ symbol: t['symbol'], asset, qty, entry_spot: sa, entry_perp: pb, entry_cost: cost, last_settlement: Date.now(), last_spot: sa, last_perp: pb });
    log.push({ type: 'OPEN', detail: `${asset} long spot ${sa} / short perp ${pb} · funding ${(Number(t['fundingRate']) * 100).toFixed(4)}%`, amount: -cost });
  }

  // 4. Equity snapshot across all history.
  const { data: all = [] } = await db.from('cloud_positions').select('*');
  let funding = 0, costs = 0, realized = 0, unrealized = 0, count = 0;
  for (const p of all ?? []) {
    funding += p.funding_paid; costs += p.entry_cost;
    if (p.closed_at) realized += p.realized ?? 0;
    else { count++; if (p.last_spot && p.last_perp) unrealized += p.qty * (p.last_spot - p.entry_spot) + p.qty * (p.entry_perp - p.last_perp); }
  }
  const equity = CLOUD_CAPITAL + funding - costs + realized + unrealized;
  await db.from('cloud_equity').insert({ equity, funding, costs, unrealized: unrealized + realized, open_count: count });
  if (log.length) await db.from('cloud_events').insert(log.map(l => ({ type: l.type, detail: l.detail, amount: l.amount ?? null })));
  return { equity, open: count, events: log.length };
}
