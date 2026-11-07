import { blockPasses, megaBlock } from './quant';

export type BlockLeg = {
  id: string; blockId: string; instrument: string; kind: 'future' | 'option';
  t: number; received: number; price: number; underlying: number; btc: number; usd: number;
  direction: string; mega: boolean; historical: boolean;
};

export type DeribitTrade = {
  trade_id?: string; block_trade_id?: string | number; instrument_name?: string;
  amount?: number; price?: number; index_price?: number; timestamp?: number; direction?: string;
};

// Inverse BTC futures amount is USD notional; BTC options amount is BTC underlying.
// Option USD value below is underlying exposure, not premium or delta-adjusted risk.
export function normalizeBlock(t: DeribitTrade, historical = false): BlockLeg | null {
  if (t.block_trade_id === undefined || t.block_trade_id === null || !t.instrument_name || !t.trade_id) return null;
  const option = /-\d+-(C|P)$/.test(t.instrument_name);
  if (!t.instrument_name.startsWith('BTC-')) return null;
  const underlying = Number(t.index_price) || (!option ? Number(t.price) : 0);
  const amount = Number(t.amount);
  if (!(underlying > 0) || !(amount > 0) || !Number.isFinite(amount) || !Number.isFinite(underlying)) return null;
  const btc = option ? amount : amount / underlying;
  return {
    id: `${t.instrument_name}:${t.trade_id}`, blockId: String(t.block_trade_id), instrument: t.instrument_name,
    kind: option ? 'option' : 'future', t: Number(t.timestamp), received: Date.now(),
    price: Number(t.price), underlying, btc, usd: btc * underlying, direction: t.direction ?? 'unknown',
    mega: megaBlock(btc), historical,
  };
}

export class BlockFeed {
  legs: BlockLeg[] = [];
  minimum = 5;
  status = 'connecting';
  lastMessage = 0;
  error = '';
  private active = false;
  private ws?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  private abort?: AbortController;
  constructor(private onBlock: (leg: BlockLeg) => void) {}
  get visible() { return this.legs.filter(l => blockPasses(l.btc, this.minimum)); }
  get groupedCount() { return new Set(this.visible.map(l => l.blockId)).size; }
  start() { this.active = true; this.open(); void this.history(); }
  stop() { this.active = false; clearTimeout(this.retry); this.abort?.abort(); if (this.ws) { this.ws.onclose = null; this.ws.close(); } }
  private add(trade: DeribitTrade, historical = false) {
    const leg = normalizeBlock(trade, historical);
    if (!leg || this.seen.has(leg.id)) return;
    this.seen.add(leg.id);
    if (this.seen.size > 5000) { const first = this.seen.values().next().value; if (first) this.seen.delete(first); }
    this.legs.push(leg); this.legs.sort((a, b) => b.t - a.t);
    this.legs = this.legs.slice(0, 200);
    this.onBlock(leg);
  }
  private async history() {
    this.abort = new AbortController();
    try {
      // Explicit kinds avoid the unsupported Coinbase-routed spot kind.
      await Promise.all(['future', 'option'].map(async kind => {
        const response = await fetch(`https://www.deribit.com/api/v2/public/get_last_trades_by_currency?currency=BTC&kind=${kind}&count=1000`, { signal: this.abort?.signal ?? null });
        if (!response.ok) throw new Error('Recent prints unavailable');
        const body = await response.json();
        if (body.error) throw new Error(body.error.message);
        for (const trade of body.result?.trades ?? []) if (this.active) this.add(trade, true);
      }));
    } catch (e) { if (this.active) this.error = e instanceof Error ? e.message : 'Recent prints unavailable'; }
  }
  private open() {
    if (!this.active) return;
    this.status = 'connecting';
    const ws = new WebSocket('wss://www.deribit.com/ws/api/v2'); this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'public/subscribe', params: { channels: ['trades.future.BTC.100ms', 'trades.option.BTC.100ms'] } }));
    ws.onerror = () => { this.status = 'error'; };
    ws.onclose = () => { if (this.active) { this.status = 'reconnecting'; this.retry = setTimeout(() => this.open(), 3000); } };
    ws.onmessage = ev => {
      try {
        const m = JSON.parse(ev.data);
        if (m.error) { this.status = 'error'; this.error = m.error.message; return; }
        if (m.id === 1 && m.result) { this.status = 'live'; this.error = ''; }
        if (m.method === 'subscription') {
          this.lastMessage = Date.now(); this.status = 'live';
          for (const t of m.params?.data ?? []) this.add(t);
        }
      } catch { this.error = 'Unreadable feed message'; }
    };
  }
}