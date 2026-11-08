import { CarryFeed } from './carryFeed';
import { DEFAULT_SETTINGS, STARTING_CAPITAL, MAX_POSITIONS, isFresh, rankCandidates, positionPnl, marginHealth, type CarryMarket, type CarryPosition } from './cashCarry';
import { sha256 } from './quant';

export type CarryEvent = { id: number; ts: number; type: string; detail: string; prevHash: string; hash: string };
export type EquityPoint = { ts: number; net: number; spot: number; treasury: number };
export const canonicalCarryEvent = (r: Omit<CarryEvent, 'hash'>) => JSON.stringify([r.id, r.ts, r.type, r.detail, r.prevHash]);
export class CarryBot {
  feed = new CarryFeed(() => this.notify());
  settings = { ...DEFAULT_SETTINGS };
  positions: CarryPosition[] = [];
  events: CarryEvent[] = [];
  curve: EquityPoint[] = [];
  enabled = false;
  realized = 0;
  funding = 0;
  costs = 0;
  drag = 0;
  started = Date.now();
  now = Date.now();
  auditError = '';
  private seq = 0;
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private previous = Date.now();
  private lastSample = 0;
  private benchmarkPnl = 0;
  private lastMarkets = new Map<string, CarryMarket>();
  private settling = new Set<number>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private notify() { this.listeners.forEach(fn => fn()); }
  start() { this.feed.start(); this.timer = setInterval(() => this.step(), 1000); }
  stop() { clearInterval(this.timer); this.feed.stop(); }
  market(p: CarryPosition) { return this.feed.markets.find(m => m.symbol === p.symbol) ?? this.lastMarkets.get(p.symbol); }
  get unrealized() { return this.positions.reduce((sum, p) => { const m = this.market(p); return sum + (m ? positionPnl(p, m) : 0); }, 0); }
  get equity() { return STARTING_CAPITAL + this.realized + this.unrealized + this.funding - this.costs - this.drag; }
  get committed() { return this.positions.reduce((sum, p) => sum + p.collateral + p.qty * p.entrySpot, 0); }
  get free() { return Math.max(0, this.equity - this.committed); }
  get candidates() { return rankCandidates(this.feed.markets, this.settings, this.now); }
  run() { this.enabled = true; this.record('BOT START', 'Cash-and-carry only · public data · simulated execution'); this.step(); }
  pause() { this.enabled = false; this.record('BOT PAUSE', 'New entries and rotations paused; open positions remain marked'); this.notify(); }
  private record(type: string, detail: string) {
    const id = ++this.seq, ts = this.now;
    this.queue = this.queue.then(async () => {
      const row = { id, ts, type, detail, prevHash: this.events.at(-1)?.hash ?? '0'.repeat(64) };
      const hash = await sha256(canonicalCarryEvent(row));
      this.events.push({ ...row, hash }); this.notify();
    }).catch(() => { this.auditError = 'Audit hashing unavailable'; this.notify(); });
  }
  close(p: CarryPosition, reason = 'Manual unwind') {
    const m = this.market(p);
    if (!m || !isFresh(m, this.now)) return false;
    this.realized += positionPnl(p, m);
    const fee = p.qty * (m.spotBid + m.perpAsk) * p.entryCostBps / 10_000;
    this.costs += fee;
    this.benchmarkPnl += p.benchmarkQty * (m.spotBid - p.entrySpot);
    this.positions = this.positions.filter(x => x.id !== p.id);
    this.record('PAPER CLOSE', `${p.asset} · ${reason} · ${p.qty.toFixed(8)} units · exit cost ${fee.toFixed(2)} USDT`);
    this.notify(); return true;
  }
  unwindAll() { this.enabled = false; for (const p of [...this.positions]) this.close(p, 'Close all'); this.notify(); }
  private async settle(p: CarryPosition, m: CarryMarket, timestamp: number) {
    this.settling.add(p.id);
    try {
      const rate = await this.feed.settledFunding(p.symbol, timestamp);
      if (rate === null) return;
      // Settlement uses current mark as an explicit approximation, not an execution price.
      const cash = p.qty * m.mark * rate;
      p.fundingPaid += cash; this.funding += cash; p.lastSettlement = m.nextFunding;
      this.record('PAPER FUNDING', `${p.asset} · settled rate ${(rate * 100).toFixed(6)}% · mark-estimated payment ${cash.toFixed(4)} USDT · settlement ${timestamp}`);
    } catch { /* Keep the pending boundary; retry on the next fresh tick, never invent a payment. */ }
    finally { this.settling.delete(p.id); this.notify(); }
  }
  private step() {
    this.now = Date.now();
    const elapsed = Math.min((this.now - this.previous) / 1000, 5); this.previous = this.now;
    for (const m of this.feed.markets) this.lastMarkets.set(m.symbol, m);
    for (const p of [...this.positions]) {
      const m = this.market(p); if (!m || !isFresh(m, this.now)) continue;
      this.drag += p.qty * p.entrySpot * p.dragApr / 100 * elapsed / (365 * 86400);
      // No invented continuous funding cash: require an exchange historical settled rate.
      if (p.lastSettlement && p.lastSettlement <= this.now && m.nextFunding > p.lastSettlement) {
        if (!this.settling.has(p.id)) void this.settle(p, m, p.lastSettlement);
      }
      if (marginHealth(p, m).buffer <= 0) this.close(p, 'Simulated margin breach');
      else if (this.enabled && m.funding <= 0) this.close(p, 'Non-positive projected funding');
    }
    if (this.enabled && !this.auditError) {
      for (const m of this.candidates) {
        if (this.positions.length >= MAX_POSITIONS || this.positions.some(p => p.asset === m.asset)) continue;
        const allocation = Math.min(STARTING_CAPITAL / MAX_POSITIONS, this.free * 0.98);
        if (allocation < 100) break;
        const qty = allocation / (m.spotAsk + m.perpBid);
        const fee = qty * (m.spotAsk + m.perpBid) * (this.settings.feeBps + this.settings.slippageBps) / 10_000;
        const p: CarryPosition = { id: ++this.seq, symbol: m.symbol, asset: m.asset, qty, entrySpot: m.spotAsk, entryPerp: m.perpBid, collateral: qty * m.perpBid, opened: this.now, lastSettlement: m.nextFunding, fundingPaid: 0, fees: fee, entryCostBps: this.settings.feeBps + this.settings.slippageBps, dragApr: this.settings.dragApr, benchmarkQty: allocation / m.spotAsk };
        this.positions.push(p); this.costs += fee;
        this.record('PAPER OPEN', `${m.asset} · long spot ${m.spotAsk} / short perp ${m.perpBid} · ${qty.toFixed(8)} units each · cost ${fee.toFixed(2)} USDT`);
      }
    }
    if (this.now - this.lastSample >= 5000) {
      const spot = STARTING_CAPITAL + this.benchmarkPnl + this.positions.reduce((sum, p) => { const m = this.market(p); return sum + (m ? p.benchmarkQty * (m.spotBid - p.entrySpot) : 0); }, 0);
      this.curve.push({ ts: this.now, net: this.equity, spot, treasury: STARTING_CAPITAL * (1 + this.settings.treasuryApr / 100 * (this.now - this.started) / (365 * 86400_000)) });
      if (this.curve.length > 5000) this.curve.shift(); this.lastSample = this.now;
    }
    this.notify();
  }
  async verify() {
    await this.queue; if (this.auditError) return false;
    let previous = '0'.repeat(64);
    for (const r of this.events) { if (r.prevHash !== previous || await sha256(canonicalCarryEvent(r)) !== r.hash) return false; previous = r.hash; }
    return true;
  }
  async csv() {
    await this.queue;
    const escape = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
    return ['id,ts,type,detail,prevHash,hash', ...this.events.map(r => [r.id, r.ts, r.type, r.detail, r.prevHash, r.hash].map(escape).join(','))].join('\n');
  }
}