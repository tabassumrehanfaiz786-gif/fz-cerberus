import { OctagonX, RotateCcw, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { CarryBot } from '@/lib/cerberus/carryBot';
import { markoutSummary, performance, rollingDrawdownPct } from '@/lib/cerberus/institutional';
import { fundingApr } from '@/lib/cerberus/cashCarry';
import { CarryBand, usd } from './CarryShared';

const Cell = ({ label, value, tone = '' }: { label: string; value: string; tone?: string }) => <div className="bg-card p-3"><div className="text-[10px] text-muted-foreground">{label}</div><div className={`mt-1 text-sm tabular-nums ${tone}`}>{value}</div></div>;

export function RiskPanel({ b }: { b: CarryBot }) {
  const lev = b.equity > 0 ? b.committed / b.equity : 0;
  const dd = rollingDrawdownPct(b.curve, b.now, b.limits.drawdownWindowMin);
  return <CarryBand title="Pre-trade risk controls · kill switch" actions={b.halted ? <Button size="sm" variant="outline" onClick={() => b.resetRisk()}><RotateCcw />Reset halt</Button> : <Button size="sm" variant="destructive" onClick={() => b.killSwitch()}><OctagonX />Kill switch</Button>}>
    <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-5">
      <Cell label="Status" value={b.halted ? `HALTED · ${b.halted}` : 'ARMED'} tone={b.halted ? 'text-mm' : 'text-bid'} />
      <Cell label={`Per-asset cap`} value={usd(b.limits.maxPositionUsd)} />
      <Cell label={`Gross leverage / limit ${b.limits.maxGrossLeverage}x`} value={`${lev.toFixed(2)}x`} tone={lev > b.limits.maxGrossLeverage * 0.9 ? 'text-warn' : ''} />
      <Cell label={`Drawdown ${b.limits.drawdownWindowMin}m / breaker ${b.limits.maxDrawdownPct}%`} value={`${dd.toFixed(3)}%`} tone={dd > b.limits.maxDrawdownPct / 2 ? 'text-warn' : ''} />
      <Cell label="Pre-trade rejections" value={String(b.rejections)} />
    </div>
  </CarryBand>;
}

export function MarkoutPanel({ b }: { b: CarryBot }) {
  const s = markoutSummary(b.markouts);
  return <CarryBand title="Post-trade markouts · adverse selection">
    <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">{s.map(x => <Cell key={x.horizon} label={`+${x.horizon}s · n=${x.n}`} value={x.n ? `${x.meanBps.toFixed(2)} bps · ${x.adversePct.toFixed(0)}% adverse` : '—'} tone={x.n ? (x.meanBps >= 0 ? 'text-bid' : 'text-mm') : ''} />)}</div>
    <p className="px-4 py-3 text-[10px] text-muted-foreground">Package move (long spot mid − short perp mid) after each paper fill, in bps of entry. Negative = basis moved against the hedge right after entry.</p>
  </CarryBand>;
}

export function PerformancePanel({ b }: { b: CarryBot }) {
  const p = performance(b.curve.map(x => x.net), 5);
  return <CarryBand title="Session performance · illustrative">
    <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-5">
      <Cell label="Sharpe (annualized)" value={p.sharpe.toFixed(2)} /><Cell label="Sortino (annualized)" value={p.sortino.toFixed(2)} />
      <Cell label="Max drawdown" value={`${p.maxDrawdownPct.toFixed(3)}%`} /><Cell label="Calmar" value={p.calmar.toFixed(2)} /><Cell label="Samples (5s)" value={String(p.samples)} />
    </div>
    <p className="px-4 py-3 text-[10px] text-muted-foreground">Annualized from a short browser session; statistically unstable and not evidence of future returns.</p>
  </CarryBand>;
}

export function CrossVenuePanel({ b }: { b: CarryBot }) {
  const rows = b.feed.markets.filter(m => b.okx.has(m.asset)).map(m => { const o = b.okx.get(m.asset)!; const by = fundingApr(m.funding, m.intervalHours), ok = fundingApr(o.rate, o.intervalHours); return { asset: m.asset, by, ok, spread: by - ok }; }).sort((a, c) => Math.abs(c.spread) - Math.abs(a.spread)).slice(0, 20);
  return <CarryBand title="Cross-venue funding · Bybit vs OKX" actions={<span className="text-[10px] text-muted-foreground">{b.okxError || `${b.okx.size} OKX swaps`}</span>}>
    <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs tabular-nums"><thead className="bg-card text-[10px] uppercase text-muted-foreground"><tr>{['Asset', 'Bybit APR', 'OKX APR', 'Divergence APR'].map(h => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.asset} className="border-t border-border"><td className="px-4 py-2">{r.asset}</td><td className="px-4 py-2">{r.by.toFixed(2)}%</td><td className="px-4 py-2">{r.ok.toFixed(2)}%</td><td className={`px-4 py-2 ${Math.abs(r.spread) > 10 ? 'text-warn' : ''}`}>{r.spread > 0 ? '+' : ''}{r.spread.toFixed(2)}%</td></tr>)}</tbody></table>
      {!rows.length && <p className="px-4 py-6 text-xs text-muted-foreground">Waiting for both venues…</p>}</div>
    <p className="px-4 py-3 text-[10px] text-muted-foreground">Current-period indicative rates from public endpoints. A divergence is not a risk-free arbitrage: it ignores fees, transfers, margin and rate changes.</p>
  </CarryBand>;
}

export function MethodologyDialog() {
  return <Dialog><DialogTrigger asChild><Button size="sm" variant="outline"><BookOpen />Methodology</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto font-mono text-xs"><DialogHeader><DialogTitle>Methodology & record-keeping</DialogTitle><DialogDescription>How Cerberus computes its figures, and what it does not claim.</DialogDescription></DialogHeader>
      <div className="space-y-3 leading-relaxed">
        <p><b>Cash-and-carry.</b> Long spot, short equal-quantity linear perpetual. Funding APR = rate × 8760 / interval hours. Paper fills at bid/ask plus assumed fee and slippage.</p>
        <p><b>Pre-trade controls.</b> Each new hedge is checked against a per-asset cap and gross leverage (committed ÷ equity). A rolling drawdown breaker halts new entries; the kill switch closes all paper hedges.</p>
        <p><b>Markouts.</b> (spot mid − entry spot) + (entry perp − perp mid), in bps of entry, at +1/5/15/60 s after each fill.</p>
        <p><b>Microstructure.</b> Micro-price weights the touch by opposite size; order-flow imbalance sums signed changes at the touch; VPIN-style toxicity uses volume-bucketed buy/sell imbalance. Walls and correlations are anonymous behavioral candidates, never firm identities.</p>
        <p><b>UK MAR Art. 12 context.</b> Article 12 defines market manipulation (e.g. false signals, layering-like behavior). Cerberus surfaces patterns for research only; it is not a surveillance system of record and makes no finding of abuse.</p>
        <p><b>Audit chain.</b> Every bot event is SHA-256 hashed with the previous hash. It lives in browser memory for this session only — not immutable storage, not regulatory certification.</p>
      </div></DialogContent></Dialog>;
}
