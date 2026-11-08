import { MAX_UNIVERSE, type CarryMarket } from './cashCarry';

type Ticker = Record<string, string>;
type Instrument = { symbol: string; baseCoin: string; quoteCoin: string; contractType: string; status: string; fundingInterval: number };
export class CarryFeed {
  markets: CarryMarket[] = [];
  status = 'connecting';
  error = '';
  updated = 0;
  private active = false;
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private abort?: AbortController;
  private instruments: Instrument[] = [];
  private spot = new Map<string, Ticker>();
  private perp = new Map<string, Ticker>();
  private sockets: WebSocket[] = [];
  private retries: ReturnType<typeof setTimeout>[] = [];
  private symbols: string[] = [];
  constructor(private onChange: () => void) {}
  start() { this.active = true; void this.refresh(); this.timer = setInterval(() => void this.refresh(), 15_000); }
  stop() { this.active = false; clearInterval(this.timer); this.abort?.abort(); this.retries.forEach(clearTimeout); this.sockets.forEach(s => { s.onclose = null; s.close(); }); }
  private async request(path: string) {
    const response = await fetch(`https://api.bybit.com/v5/market/${path}`, { signal: this.abort?.signal });
    if (!response.ok) throw new Error(`Bybit public data unavailable (${response.status})`);
    const body = await response.json();
    if (body.retCode !== 0) throw new Error(body.retMsg || 'Public feed error');
    return body.result;
  }
  async refresh() {
    if (!this.active || this.busy) return;
    this.busy = true; this.abort = new AbortController();
    try {
      if (!this.instruments.length) {
        let cursor = '';
        do {
          const result = await this.request(`instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
          this.instruments.push(...result.list.filter((i: Instrument) => i.quoteCoin === 'USDT' && i.status === 'Trading' && i.contractType === 'LinearPerpetual' && i.fundingInterval > 0));
          cursor = result.nextPageCursor || '';
        } while (cursor && this.active);
      }
      const [spot, perp] = await Promise.all([this.request('tickers?category=spot'), this.request('tickers?category=linear')]);
      if (!this.active) return;
      this.spot = new Map(spot.list.map((t: Ticker) => [t.symbol, { ...t, received: String(Date.now()) }]));
      this.perp = new Map(perp.list.map((t: Ticker) => [t.symbol, { ...t, received: String(Date.now()) }]));
      this.rebuild(); this.status = 'live'; this.error = '';
      if (!this.symbols.length) { this.symbols = this.markets.map(m => m.symbol); this.open('spot'); this.open('linear'); }
    } catch (e) {
      if (this.active) { this.status = this.markets.length ? 'stale' : 'unavailable'; this.error = e instanceof Error ? e.message : 'Live data unavailable'; }
    } finally { this.busy = false; if (this.active) this.onChange(); }
  }
  private rebuild() {
    const now = Date.now();
    this.markets = this.instruments.flatMap(i => {
      const s = this.spot.get(i.symbol), p = this.perp.get(i.symbol);
      if (!s || !p || ['USDC', 'USDT', 'DAI', 'TUSD', 'FDUSD'].includes(i.baseCoin)) return [];
      const m: CarryMarket = { symbol: i.symbol, asset: i.baseCoin, spotBid: +s.bid1Price, spotAsk: +s.ask1Price, perpBid: +p.bid1Price, perpAsk: +p.ask1Price, mark: +p.markPrice, funding: +p.fundingRate, intervalHours: i.fundingInterval / 60, nextFunding: +p.nextFundingTime, volume: Math.min(+s.turnover24h, +p.turnover24h), ts: Math.min(+s.received, +p.received) };
      return Object.values(m).every(v => typeof v !== 'number' || Number.isFinite(v)) && m.spotBid > 0 && m.perpBid > 0 ? [m] : [];
    }).sort((a, b) => b.volume - a.volume).slice(0, MAX_UNIVERSE);
    this.updated = now; this.onChange();
  }
  private open(category: 'spot' | 'linear') {
    if (!this.active || !this.symbols.length) return;
    const ws = new WebSocket(`wss://stream.bybit.com/v5/public/${category}`); this.sockets.push(ws);
    const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })); }, 20_000);
    ws.onopen = () => {
      for (let i = 0; i < this.symbols.length; i += 10) ws.send(JSON.stringify({ op: 'subscribe', args: this.symbols.slice(i, i + 10).map(s => `tickers.${s}`) }));
    };
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.op === 'subscribe' && !message.success) { this.error = 'Streaming unavailable; 15-second public snapshots active'; this.onChange(); }
        if (!message.topic?.startsWith('tickers.') || !message.data) return;
        const symbol = message.topic.slice(8), map = category === 'spot' ? this.spot : this.perp;
        map.set(symbol, { ...map.get(symbol), ...message.data, received: String(Date.now()) });
        this.rebuild();
      } catch { /* REST snapshots remain the recovery path. */ }
    };
    ws.onerror = () => { this.error = 'Streaming interrupted; public snapshots remain active'; this.onChange(); };
    ws.onclose = () => { clearInterval(ping); this.sockets = this.sockets.filter(s => s !== ws); if (this.active) this.retries.push(setTimeout(() => this.open(category), 5000)); };
    ws.addEventListener('close', () => clearInterval(ping));
  }
}