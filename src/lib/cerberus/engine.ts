// Project Cerberus — client-side market engine. Pure browser code (WebSocket), no server.
export type Level = [number, number];
export type Book = { bids: Level[]; asks: Level[]; ts: number };
export type Trade = { p: number; q: number; t: number; recv: number; takerSell: boolean };
export type Echo = { id: number; spot: Trade; perp: Trade; latency: number; side: "MM LONG→HEDGE SHORT" | "MM SHORT→HEDGE LONG"; born: number };
export type Retreat = { id: number; side: "bid" | "ask"; pMin: number; pMax: number; qty: number; dt: number; toxic: boolean; born: number };
export type LedgerRow = { id: number; ts: number; type: string; article: string; detail: string; hash: string };
export type Column = { ts: number; mid: number; levels: Level[]; mmLevels: Level[] };
export type Bubble = { id: number; p: number; q: number; t: number; takerSell: boolean; venue: "spot" | "perp"; hit?: "ABSORBED" | "SWEPT" };
export type Wall = { p: number; q: number; side: "bid" | "ask"; dist: number };

export const MAR = {
  echo: "MAR Art.12(1)(a)(i) — coordinated cross-venue orders",
  retreat: "MAR Art.12(2)(c) / Annex I A(d) — layering/spoofing indicator",
  skew: "MAR Art.12(1)(a)(ii) — price-level signal (inventory skew)",
  fill: "MAR Art.16 — own-account trading record (paper)",
};

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
};

export class CerberusEngine {
  spot: Book = { bids: [], asks: [], ts: 0 };
  perp: Book = { bids: [], asks: [], ts: 0 };
  columns: Column[] = [];
  maxCols = 600; // 1 column / 500ms => 5 min history
  bucket = 2; // $ price bucket for heatmap aggregation
  bubbles: Bubble[] = [];
  walls: Wall[] = [];
  private deep: Level[] = [];
  private deepSide = new Map<number, "bid" | "ask">();
  private tick = 0;
  spotTrades: Trade[] = [];
  perpTrades: Trade[] = [];
  echoes: Echo[] = [];
  retreats: Retreat[] = [];
  ledger: LedgerRow[] = [];
  status = { spot: "connecting", perp: "connecting", spotLat: 0, perpLat: 0, msgs: 0 };
  // Avellaneda-Stoikov inference
  sigma = 0; // $ per sqrt(s)
  inferredQ = 0;
  private lastMid = 0; private lastMidT = 0; private varEwma = 0;
  // Bot
  gamma = 0.1; kappa = 1.5; tau = 1; size = 0.01; maxInv = 0.2;
  bot = { q: 0, hedge: 0, cash: 0, bid: 0, ask: 0, res: 0, fills: 0, spreadPnl: 0, equity: 0, enabled: true };
  equity: { t: number; v: number }[] = [];
  private seq = 0;
  private sockets: WebSocket[] = [];
  private prevSpot: Book | null = null;
  private pendingRetreats: { side: "bid" | "ask"; pMin: number; pMax: number; qty: number; ts: number }[] = [];

  static SPOT = "BTC-USD";
  static PERP = "BIP-20DEC30-CDE"; // Coinbase US BTC perpetual (0.01 BTC / contract)
  static PERP_MULT = 0.01;
  private books = { spot: { bid: new Map<number, number>(), ask: new Map<number, number>(), ts: 0 }, perp: { bid: new Map<number, number>(), ask: new Map<number, number>(), ts: 0 } };
  private timer: ReturnType<typeof setInterval> | undefined;

  start() {
    this.open();
    this.timer = setInterval(() => {
      const snap = (v: "spot" | "perp"): Book => {
        const b = this.books[v];
        return {
          bids: [...b.bid].sort((x, y) => y[0] - x[0]).slice(0, 40),
          asks: [...b.ask].sort((x, y) => x[0] - y[0]).slice(0, 40),
          ts: b.ts || Date.now(),
        };
      };
      if (this.books.perp.bid.size) this.perp = snap("perp");
      if (this.books.spot.bid.size) {
        // deep bucketed book (±$300) for MM wall detection
        const sb = this.books.spot, B = this.bucket, agg = new Map<number, number>();
        const top = [...sb.bid.keys()].reduce((a, b) => Math.max(a, b), 0);
        for (const [p, q] of sb.bid) if (top - p < 300) { const k = Math.floor(p / B) * B; agg.set(k, (agg.get(k) ?? 0) + q); }
        for (const [p, q] of sb.ask) if (p - top < 300) { const k = Math.floor(p / B) * B + B; agg.set(-k, (agg.get(-k) ?? 0) + q); }
        this.deep = [...agg].map(([k, q]) => [Math.abs(k), q] as Level);
        this.deepSide = new Map([...agg].map(([k]) => [Math.abs(k), k < 0 ? "ask" : "bid"] as [number, "bid" | "ask"]));
        this.onSpotBook(snap("spot"));
      }
    }, 100);
  }
  stop() { clearInterval(this.timer); this.sockets.forEach((s) => { s.onclose = null; s.close(); }); this.sockets = []; }

  private open() {
    const ws = new WebSocket("wss://advanced-trade-ws.coinbase.com");
    const ids = [CerberusEngine.SPOT, CerberusEngine.PERP];
    ws.onopen = () => {
      for (const channel of ["level2", "market_trades", "heartbeats"]) ws.send(JSON.stringify({ type: "subscribe", product_ids: ids, channel }));
      this.status.spot = this.status.perp = "live";
    };
    ws.onerror = () => (this.status.spot = this.status.perp = "error");
    ws.onclose = () => { this.status.spot = this.status.perp = "reconnecting"; setTimeout(() => this.open(), 2000); };
    ws.onmessage = (ev) => {
      this.status.msgs++;
      const m = JSON.parse(ev.data);
      const now = Date.now();
      if (m.channel === "l2_data") {
        for (const e of m.events ?? []) {
          const v = e.product_id === CerberusEngine.SPOT ? "spot" : e.product_id === CerberusEngine.PERP ? "perp" : null;
          if (!v) continue;
          const b = this.books[v];
          if (e.type === "snapshot") { b.bid.clear(); b.ask.clear(); }
          const mult = v === "perp" ? CerberusEngine.PERP_MULT : 1;
          for (const u of e.updates ?? []) {
            const side = u.side === "bid" ? b.bid : b.ask;
            const p = +u.price_level, q = +u.new_quantity * mult;
            if (q === 0) side.delete(p); else side.set(p, q);
            const t = Date.parse(u.event_time);
            if (t) { b.ts = t; this.status[v === "spot" ? "spotLat" : "perpLat"] = Math.max(0, now - t); }
          }
        }
      } else if (m.channel === "market_trades") {
        for (const e of m.events ?? []) {
          if (e.type !== "update") continue;
          for (const tr of [...(e.trades ?? [])].reverse()) {
            const v = tr.product_id === CerberusEngine.SPOT ? "spot" : tr.product_id === CerberusEngine.PERP ? "perp" : null;
            if (!v) continue;
            const mult = v === "perp" ? CerberusEngine.PERP_MULT : 1;
            const t: Trade = { p: +tr.price, q: +tr.size * mult, t: Date.parse(tr.time), recv: now, takerSell: tr.side === "SELL" };
            v === "spot" ? this.onSpotTrade(t) : this.onPerpTrade(t);
          }
        }
      }
    };
    this.sockets.push(ws);
  }

  mid(b: Book) { return b.bids.length && b.asks.length ? (b.bids[0]![0] + b.asks[0]![0]) / 2 : 0; }
  micro(b: Book) {
    if (!b.bids.length || !b.asks.length) return 0;
    const [bp, bq] = b.bids[0]!, [ap, aq] = b.asks[0]!;
    return (bp * aq + ap * bq) / (bq + aq);
  }

  private log(type: string, article: string, detail: string) {
    const ts = Date.now();
    const prev = this.ledger[0]?.hash ?? "genesis";
    this.ledger.unshift({ id: ++this.seq, ts, type, article, detail, hash: fnv(prev + ts + type + detail) });
    if (this.ledger.length > 500) this.ledger.pop();
  }

  private onSpotBook(book: Book) {
    const now = Date.now();
    const m = this.mid(book);
    // volatility (EWMA of squared returns, $/sqrt(s))
    if (this.lastMid && m) {
      const dt = Math.max(0.05, (now - this.lastMidT) / 1000);
      const r2 = Math.min((m - this.lastMid) ** 2 / dt, 400);
      this.varEwma = this.varEwma ? 0.97 * this.varEwma + 0.03 * r2 : r2;
      this.sigma = Math.sqrt(this.varEwma);
    }
    this.lastMid = m; this.lastMidT = now;
    // A-S inversion: microprice = r  =>  q = (s - r)/(γσ²τ)
    const denom = this.gamma * Math.max(this.sigma ** 2, 1e-4) * this.tau;
    const qRaw = (m - this.micro(book)) / denom;
    this.inferredQ = 0.9 * this.inferredQ + 0.1 * Math.max(-5, Math.min(5, qRaw));
    // Retreat detection: depth pulled near touch between snapshots
    if (this.prevSpot) {
      for (const side of ["bid", "ask"] as const) {
        const prev = side === "bid" ? this.prevSpot.bids : this.prevSpot.asks;
        const cur = new Map(side === "bid" ? book.bids : book.asks);
        let pulled = 0, pMin = Infinity, pMax = -Infinity;
        for (const [p, q] of prev.slice(0, 10)) {
          const d = q - (cur.get(p) ?? 0);
          // only count levels still inside the book (not consumed by price moving through)
          const inside = side === "bid" ? p <= (book.bids[0]?.[0] ?? 0) : p >= (book.asks[0]?.[0] ?? Infinity);
          if (d > 0 && inside) { pulled += d; pMin = Math.min(pMin, p); pMax = Math.max(pMax, p); }
        }
        if (pulled > 5) this.pendingRetreats.push({ side, pMin, pMax, qty: pulled, ts: book.ts });
      }
    }
    this.pendingRetreats = this.pendingRetreats.filter((r) => now - r.ts < 1000);
    this.prevSpot = book;
    this.spot = book;
    // heatmap column (bucketed deep book) + MM wall overlay
    const levels = this.deep.map(([p, q]) => [p, q] as Level);
    const sizes = levels.map((l) => l[1]).sort((x, y) => x - y);
    const p92 = sizes[Math.floor(sizes.length * 0.92)] ?? 0;
    const med = sizes[Math.floor(sizes.length / 2)] ?? 0;
    const wall = Math.max(1, med * 5, p92);
    const mmLevels = levels.filter(([, q]) => q >= wall);
    this.walls = mmLevels
      .map(([p, q]) => ({ p, q, side: this.deepSide.get(p) ?? "bid", dist: p - m }))
      .sort((a, b) => b.q - a.q);
    if (++this.tick % 5 === 0) {
      this.columns.push({ ts: now, mid: m, levels, mmLevels });
      if (this.columns.length > this.maxCols) this.columns.shift();
    }
    this.requote();
    this.markEquity();
  }

  private addBubble(t: Trade, venue: "spot" | "perp") {
    if (t.q < 0.05) return;
    const b: Bubble = { id: ++this.seq, p: t.p, q: t.q, t: t.recv, takerSell: t.takerSell, venue };
    if (venue === "spot" && t.q >= 0.25) {
      const w = this.walls.find((w) => Math.abs(w.p - t.p) <= this.bucket * 1.5);
      if (w) {
        b.hit = t.q >= w.q ? "SWEPT" : "ABSORBED";
        this.log(`WALL_${b.hit}`, MAR.skew, `${t.takerSell ? "SELL" : "BUY"} ${t.q.toFixed(3)} BTC hit ${w.q.toFixed(2)} BTC ${w.side} wall @ ${w.p}`);
      }
    }
    this.bubbles.push(b);
    if (this.bubbles.length > 400) this.bubbles.shift();
  }

  private onSpotTrade(t: Trade) {
    this.addBubble(t, "spot");
    this.spotTrades.push(t);
    if (this.spotTrades.length > 400) this.spotTrades.shift();
    // toxic retreat: pull occurred shortly before this trade
    for (const r of this.pendingRetreats.splice(0)) {
      const dt = t.t - r.ts;
      if (dt < 0 || dt > 250) continue;
      const toxic = dt < 5;
      this.retreats.push({ id: ++this.seq, side: r.side, pMin: r.pMin, pMax: r.pMax, qty: r.qty, dt, toxic, born: Date.now() });
      if (toxic) this.log("TOXIC_RETREAT", MAR.retreat, `${r.qty.toFixed(2)} BTC ${r.side} pulled ${dt}ms pre-trade @ ${r.pMin}-${r.pMax}`);
    }
    if (this.retreats.length > 40) this.retreats.shift();
    this.paperFill(t);
  }

  private onPerpTrade(t: Trade) {
    this.addBubble(t, "perp");
    this.perpTrades.push(t);
    if (this.perpTrades.length > 400) this.perpTrades.shift();
    // Echo matcher: spot maker fill followed 10-50ms later by same-direction perp taker hedge.
    // spot takerSell => maker bought (long) => hedge = perp taker sell
    for (let i = this.spotTrades.length - 1; i >= 0; i--) {
      const s = this.spotTrades[i]!;
      const lat = t.t - s.t;
      if (lat > 50) break;
      if (lat < 10 || s.takerSell !== t.takerSell) continue;
      if (Math.abs(t.q - s.q) / Math.max(s.q, 1e-9) > 0.25 || s.q < 0.05) continue;
      const e: Echo = { id: ++this.seq, spot: s, perp: t, latency: lat, side: s.takerSell ? "MM LONG→HEDGE SHORT" : "MM SHORT→HEDGE LONG", born: Date.now() };
      this.echoes.push(e);
      if (this.echoes.length > 60) this.echoes.shift();
      this.log("ECHO_HEDGE", MAR.echo, `${s.q.toFixed(3)} BTC spot@${s.p} ↔ perp@${t.p} Δ${lat}ms ${e.side}`);
      this.spotTrades.splice(i, 1);
      break;
    }
  }

  private requote() {
    const s = this.mid(this.spot);
    if (!s) return;
    const g = this.gamma, sig2 = Math.max(this.sigma ** 2, 0.01), q = this.bot.q / this.size;
    const res = s - q * g * sig2 * this.tau;
    const half = (g * sig2 * this.tau + (2 / g) * Math.log(1 + g / this.kappa)) / 2;
    const tick = 0.01;
    this.bot.res = res;
    this.bot.bid = Math.min(Math.floor((res - half) / tick) * tick, this.spot.bids[0]?.[0] ?? s);
    this.bot.ask = Math.max(Math.ceil((res + half) / tick) * tick, this.spot.asks[0]?.[0] ?? s);
  }

  private paperFill(t: Trade) {
    const b = this.bot;
    if (!b.enabled || !b.bid) return;
    const s = this.mid(this.spot);
    let side = 0;
    if (t.takerSell && t.p <= b.bid && b.q < this.maxInv) side = 1;
    else if (!t.takerSell && t.p >= b.ask && b.q > -this.maxInv) side = -1;
    if (!side) return;
    const px = side > 0 ? b.bid : b.ask;
    b.q += side * this.size; b.cash -= side * this.size * px;
    b.spreadPnl += Math.abs(s - px) * this.size;
    b.fills++;
    // zero-delta flash hedge on perp at touch (taker)
    const hp = side > 0 ? this.perp.bids[0]?.[0] : this.perp.asks[0]?.[0];
    if (hp) { b.hedge -= side * this.size; b.cash += side * this.size * hp; }
    this.log("BOT_FILL", MAR.fill, `${side > 0 ? "BUY" : "SELL"} ${this.size} spot@${px.toFixed(2)} | hedge ${side > 0 ? "SELL" : "BUY"} perp@${hp?.toFixed(1)}`);
    this.requote();
  }

  netDelta() { return this.bot.q + this.bot.hedge; }

  private markEquity() {
    const s = this.mid(this.spot), f = this.mid(this.perp);
    if (!s || !f) return;
    const v = this.bot.cash + this.bot.q * s + this.bot.hedge * f;
    this.bot.equity = v;
    const now = Date.now();
    const last = this.equity[this.equity.length - 1];
    if (!last || now - last.t > 1000) { this.equity.push({ t: now, v }); if (this.equity.length > 900) this.equity.shift(); }
  }

  sharpe() {
    const e = this.equity;
    if (e.length < 10) return 0;
    const r = e.slice(1).map((x, i) => x.v - e[i]!.v);
    const mu = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / r.length) || 1e-9;
    return (mu / sd) * Math.sqrt(86400 * 365);
  }

  exportCsv() {
    const rows = [["id", "utc", "type", "article", "detail", "hash"], ...this.ledger.map((r) => [r.id, new Date(r.ts).toISOString(), r.type, r.article, r.detail, r.hash])];
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  }
}
