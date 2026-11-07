export type Touch = { bid: number; ask: number; bidSize: number; askSize: number };

// Size-weighted touch approximation, not the calibrated multi-state Stoikov model.
export function microPrice(t: Touch) {
  const total = t.bidSize + t.askSize;
  return total > 0 ? (t.bid * t.askSize + t.ask * t.bidSize) / total : (t.bid + t.ask) / 2;
}

// Price-aware best-quote OFI (Cont-style event contribution), sampled at 100ms.
export function touchOfi(previous: Touch, current: Touch) {
  return (current.bid >= previous.bid ? current.bidSize : 0)
    - (current.bid <= previous.bid ? previous.bidSize : 0)
    - (current.ask <= previous.ask ? current.askSize : 0)
    + (current.ask >= previous.ask ? previous.askSize : 0);
}

export function basisBps(spot: number, perp: number) {
  return spot > 0 && perp > 0 ? (perp - spot) / spot * 10_000 : 0;
}

export function basisOpportunity(basis: number, hurdle: number, valid: boolean) {
  return valid && basis > hurdle;
}

export class VolumeToxicity {
  private buy = 0;
  private sell = 0;
  private imbalance: number[] = [];
  constructor(public bucketSize = 1, public window = 50) {}
  add(quantity: number, takerSell: boolean) {
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    let left = quantity;
    while (left > 1e-10) {
      const part = Math.min(left, this.bucketSize - this.buy - this.sell);
      if (takerSell) this.sell += part; else this.buy += part;
      left -= part;
      if (this.buy + this.sell >= this.bucketSize - 1e-10) {
        this.imbalance.push(Math.abs(this.buy - this.sell));
        if (this.imbalance.length > this.window) this.imbalance.shift();
        this.buy = 0; this.sell = 0;
      }
    }
  }
  get completed() { return this.imbalance.length; }
  get ready() { return this.completed >= this.window; }
  get value() { return this.ready ? this.imbalance.reduce((a, b) => a + b, 0) / (this.window * this.bucketSize) : null; }
  get toxic() { return this.value !== null && this.value >= 0.7; }
}

export function blockPasses(btc: number, minimum = 5) { return btc >= minimum; }
export function megaBlock(btc: number) { return btc >= 50; }

export function idealizedSpread(mid: number, quote: number, quantity: number) {
  return Math.abs(mid - quote) * quantity;
}

export function canonicalAudit(row: { id: number; ts: number; type: string; article: string; detail: string; prevHash: string }) {
  return JSON.stringify([row.id, row.ts, row.type, row.article, row.detail, row.prevHash]);
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}