import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Download, Pause, Play, ShieldCheck, Minus, Plus } from 'lucide-react';
import { CerberusEngine } from '@/lib/cerberus/engine';
import { Heatmap } from '@/components/cerberus/Heatmap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const Route = createFileRoute('/')({
  head: () => ({ meta: [
    { title: 'Cerberus — Quantitative Market Surveillance' },
    { name: 'description', content: 'Live Coinbase liquidity, anonymous wall behavior, Deribit block reports, micro-price, order flow and idealized paper trading.' },
    { property: 'og:title', content: 'Cerberus — Quantitative Market Surveillance' },
    { property: 'og:description', content: 'Public order-flow intelligence and exchange-reported block trades with a verifiable session audit chain.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' },
  ] }), component: Terminal,
});
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(value) < 1000 ? 2 : 0 }).format(value);
const utc = (t: number) => new Date(t).toISOString().slice(11, 23);

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'warn' }) {
  const c = tone === 'up' ? 'text-bid' : tone === 'down' ? 'text-mm' : tone === 'warn' ? 'text-warn' : 'text-foreground';
  return <div className="min-w-0 border-b border-r border-border px-3 py-2"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className={`break-words text-sm tabular-nums ${c}`}>{value}</div></div>;
}
function Panel({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={`terminal-panel flex min-w-0 flex-col bg-card ${className}`}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2"><h2 className="text-[11px] font-semibold uppercase text-muted-foreground">{title}</h2>{actions}</div><div className="min-h-0 flex-1 overflow-auto p-3">{children}</div></section>;
}
function Equity({ data }: { data: { t: number; v: number }[] }) {
  if (data.length < 2) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Waiting for paper observations</div>;
  const min = Math.min(0, ...data.map(d => d.v)), max = Math.max(0, ...data.map(d => d.v));
  const span = max - min || 1;
  const pts = data.map((d, i) => `${i / (data.length - 1) * 100},${38 - (d.v - min) / span * 34}`).join(' ');
  return <svg aria-label="Paper performance chart" viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full"><line x1="0" y1="38" x2="100" y2="38" stroke="var(--border)" /><polyline points={pts} fill="none" stroke="var(--bid)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="py-5 text-xs text-muted-foreground">{children}</p>; }
function Terminal() {
  const [engine, setEngine] = useState<CerberusEngine | null>(null);
  const [, tick] = useState(0);
  const [range, setRange] = useState(300);
  const [chart, setChart] = useState<'capture' | 'mtm'>('capture');
  const [audit, setAudit] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const e = new CerberusEngine(); e.start(); setEngine(e); const id = setInterval(() => tick(n => n + 1), 250); return () => { clearInterval(id); e.stop(); }; }, []);
  if (!engine) return <div className="flex min-h-screen items-center justify-center bg-background font-mono text-muted-foreground">Booting Cerberus…</div>;
  const e = engine, mid = e.mid(e.spot), pmid = e.mid(e.perp), vpin = e.toxicity.value;
  const download = async () => {
    setExporting(true);
    try { await e.flushAudit(); const url = URL.createObjectURL(new Blob([e.exportCsv()], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = `cerberus-session-audit-${Date.now()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    finally { setExporting(false); }
  };
  const zoom = <div className="flex items-center gap-2 text-[10px]"><Button variant="ghost" size="icon" className="h-6 w-6" title="Wider price range" aria-label="Wider price range" disabled={range >= 300} onClick={() => setRange(n => Math.min(300, n + 50))}><Minus /></Button><span className="w-14 text-center">±${range}</span><Button variant="ghost" size="icon" className="h-6 w-6" title="Narrower price range" aria-label="Narrower price range" disabled={range <= 50} onClick={() => setRange(n => Math.max(50, n - 50))}><Plus /></Button></div>;
  return <main className="min-h-screen bg-background font-mono text-foreground">
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-4 py-3"><h1 className="text-lg font-bold">CERBERUS<span className="ml-1 text-mm">▲</span></h1><span className="text-[10px] uppercase text-muted-foreground">Quantitative market surveillance</span><div className="ml-auto flex flex-wrap gap-3 text-[10px]">{(['spot', 'perp'] as const).map(v => <span key={v} className={e.status[v] === 'live' ? 'text-bid' : 'text-warn'}>● {v.toUpperCase()} {e.status[v]} · {e.status[v === 'spot' ? 'spotLat' : 'perpLat']}ms</span>)}<span className={e.blocks.status === 'live' ? 'text-perp' : 'text-warn'}>● DERIBIT {e.blocks.status}</span></div></header>
    <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4 xl:grid-cols-8">
      <Stat label="Coinbase spot · USD" value={mid ? money(mid) : 'Awaiting book'} /><Stat label="US perp · USD" value={pmid ? money(pmid) : 'Awaiting book'} />
      <Stat label="Micro-price · touch approx." value={mid ? money(e.micro(e.spot)) : '—'} />
      <Stat label="OFI · 1s / BTC" value={`${e.rollingOfi >= 0 ? '+' : ''}${e.rollingOfi.toFixed(3)}`} tone={e.rollingOfi >= 0 ? 'up' : 'down'} />
      <Stat label="Basis · bps" value={e.fresh ? e.basis.toFixed(2) : 'Unavailable'} tone={e.opportunity ? 'warn' : undefined} />
      <Stat label="VPIN · 50 × 1 BTC" value={vpin === null ? `Warming ${e.toxicity.completed}/50` : `${(vpin * 100).toFixed(1)}%`} tone={e.toxicity.toxic ? 'warn' : undefined} />
      <Stat label="Paper net delta" value={`${e.netDelta().toFixed(2)} BTC`} tone="up" /><Stat label="Paper MTM · idealized" value={money(e.bot.equity)} tone={e.bot.equity >= 0 ? 'up' : 'down'} />
    </div>
    <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2 text-[10px]"><span className={e.opportunity ? 'text-warn' : 'text-muted-foreground'}>{e.opportunity ? 'BASIS ABOVE HURDLE · REVIEW COSTS' : e.fresh ? 'BASIS BELOW HURDLE' : 'BASIS SIGNAL PAUSED · FEED UNAVAILABLE'}</span><label className="flex items-center gap-2">Hurdle bps<Input type="number" min="0" max="1000" step="1" aria-label="Basis hurdle in basis points" value={e.hurdle} onChange={ev => { const n = Number(ev.target.value); if (Number.isFinite(n)) { e.hurdle = Math.max(0, Math.min(1000, n)); tick(x => x + 1); } }} className="h-7 w-20 text-xs" /></label><span className="text-muted-foreground">Spot/perp premium only · not annualized yield · funding and fees excluded</span></div>
    <div className="grid grid-cols-1 gap-px bg-border xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-px xl:col-span-8">
        <Panel title="Passive limit liquidity · BTC-USD" actions={zoom}><div className="h-[300px] sm:h-[360px]"><Heatmap engine={e} range={range} /></div><div className="mt-2 flex flex-wrap gap-4 text-[10px]"><span className="text-bid">■ Resting depth</span><span className="text-perp">━ Micro-price</span><span className="text-muted-foreground">● Aggressive trade prints</span></div></Panel>
        <Panel title="Large passive walls · anonymous behavior" actions={<span className="text-[10px] text-muted-foreground">$2 buckets · ±${range}</span>}><div className="h-[300px] sm:h-[360px]"><Heatmap engine={e} mode="mm" range={range} /></div><div className="mt-2 flex flex-wrap gap-4 text-[10px]"><span className="text-mm">■ Large visible limit orders</span><span className="text-warn">━ Deribit futures block legs</span><span className="text-muted-foreground">Same public book · size-filtered</span></div></Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-px xl:col-span-4">
        <Panel title="Top 10 visible walls · BTC / USD">
          {e.walls.length ? <table className="w-full text-[11px]"><thead className="text-left text-[9px] uppercase text-muted-foreground"><tr><th>Side / price</th><th className="text-right">Size / exposure</th><th className="text-right">Age</th></tr></thead><tbody>{e.walls.slice(0, 10).map(w => <tr key={w.side + w.p} className="border-b border-border"><td className="py-2"><span className={w.side === 'bid' ? 'text-bid' : 'text-mm'}>{w.side.toUpperCase()}</span><div>{money(w.p)}</div><div className="mt-1 max-w-40 break-words text-[9px] text-warn">{w.tags.join(' · ') || 'Large visible order'}</div></td><td className="text-right align-top pt-2">{w.q.toFixed(2)} BTC<div className="text-muted-foreground">{money(w.usd)}</div><div className="text-[9px] text-muted-foreground">{w.dist >= 0 ? '+' : ''}{w.dist.toFixed(0)} USD from mid</div></td><td className="text-right align-top pt-2 text-muted-foreground">{w.age.toFixed(0)}s</td></tr>)}</tbody></table> : <Empty>Waiting for large resting liquidity</Empty>}
        </Panel>
        <Panel title="A-S paper quotes · midpoint hedge" actions={<Button variant="outline" size="sm" onClick={() => { e.bot.enabled = !e.bot.enabled; tick(n => n + 1); }}>{e.bot.enabled ? <Pause /> : <Play />}{e.bot.enabled ? 'Halt bot' : 'Resume bot'}</Button>}>
          <div className="grid grid-cols-2 gap-y-2 text-xs"><span className="text-muted-foreground">Bid / ask</span><span><span className="text-bid">{e.bot.bid.toFixed(2)}</span> / <span className="text-mm">{e.bot.ask.toFixed(2)}</span></span><span className="text-muted-foreground">Reservation</span><span>{e.bot.res.toFixed(2)}</span><span className="text-muted-foreground">Spot / perp BTC</span><span>{e.bot.q.toFixed(2)} / {e.bot.hedge.toFixed(2)}</span><span className="text-muted-foreground">Paper fills</span><span>{e.bot.fills}</span><span className="text-muted-foreground">Gross spread capture</span><span className="text-bid">{money(e.bot.spreadPnl)}</span><span className="text-muted-foreground">Signed basis contribution</span><span className={e.bot.basisPnl >= 0 ? 'text-bid' : 'text-mm'}>{money(e.bot.basisPnl)}</span><span className="text-muted-foreground">VPIN warning</span><span className={e.toxicity.toxic ? 'text-warn' : 'text-muted-foreground'}>{e.toxicity.toxic ? 'HIGH TOXICITY' : vpin === null ? 'Warming up' : 'Below 70%'}</span></div>
        </Panel>
      </div>
      <Panel title="Deribit exchange-reported block tape" className="xl:col-span-8" actions={<label className="flex items-center gap-2 text-[10px]">Minimum BTC<Input aria-label="Minimum block size in BTC" type="number" min="5" max="10000" step="5" value={e.blocks.minimum} onChange={ev => { const n = Number(ev.target.value); if (Number.isFinite(n)) { e.blocks.minimum = Math.max(5, Math.min(10000, n)); tick(x => x + 1); } }} className="h-7 w-20 text-xs" /></label>}>
        <div className="mb-2 text-[10px] text-muted-foreground">{e.blocks.groupedCount} block IDs · {e.blocks.visible.length} qualifying legs · USD = underlying exposure, not option premium</div>
        {e.blocks.error && <p className="mb-2 text-[10px] text-warn">{e.blocks.error}</p>}
        <div className="max-h-64 overflow-auto">{e.blocks.visible.length ? <table className="w-full min-w-[620px] text-[10px]"><thead className="text-left uppercase text-muted-foreground"><tr><th>UTC / source</th><th>Block ID / leg</th><th>Direction</th><th>Underlying BTC</th><th>USD exposure</th><th>Reaction</th></tr></thead><tbody>{e.blocks.visible.slice(0, 60).map(l => <tr key={l.id} className="border-b border-border"><td className="py-2 text-muted-foreground">{utc(l.t)}<div>{l.historical ? 'Recent history' : 'Live print'}</div></td><td>{l.mega && <span className="text-warn">MEGA · </span>}{l.blockId}<div className="text-muted-foreground">{l.instrument}</div></td><td>{l.direction}</td><td className="text-warn">{l.btc.toFixed(3)} BTC</td><td>{money(l.usd)}</td><td>{e.blockReactions.find(r => r.blockId === l.blockId)?.dt !== undefined ? `${e.blockReactions.find(r => r.blockId === l.blockId)?.dt}ms · temporal only` : '—'}</td></tr>)}</tbody></table> : <Empty>No qualifying reported block legs yet. The feed also carries ordinary trades; only block-marked prints appear here.</Empty>}</div>
      </Panel>
      <Panel title="Paper performance · no guaranteed returns" className="xl:col-span-4" actions={<div className="flex gap-1"><Button size="sm" variant={chart === 'capture' ? 'secondary' : 'ghost'} onClick={() => setChart('capture')}>Gross capture</Button><Button size="sm" variant={chart === 'mtm' ? 'secondary' : 'ghost'} onClick={() => setChart('mtm')}>MTM P&L</Button></div>}>
        <div className="flex justify-between text-xs"><span className="text-bid">{money(chart === 'capture' ? e.bot.spreadPnl : e.bot.equity)}</span><span className="text-muted-foreground">Session ratio: {e.sharpe()?.toFixed(2) ?? 'insufficient sample'}</span></div><div className="my-3 h-36"><Equity data={chart === 'capture' ? e.captureEquity : e.equity} /></div><p className="text-[10px] text-muted-foreground">{chart === 'capture' ? 'Gross capture is cumulative by construction; excludes losses, fees, basis and funding. A rising line is not net equity.' : 'Idealized mark-to-market includes signed basis movements and may fall. Midpoint hedges exclude real execution costs.'}</p>
      </Panel>
      <Panel title="Cross-venue echo candidates · 10–50ms" className="xl:col-span-4"><div className="max-h-56 overflow-auto">{e.echoes.length ? <table className="w-full text-[10px]"><tbody>{e.echoes.slice(-30).reverse().map(x => <tr key={x.id} className="border-b border-border"><td className="py-2 text-muted-foreground">{utc(x.spot.t)}</td><td>{x.spot.q.toFixed(3)} BTC</td><td className="text-mm">{x.latency}ms</td><td className="text-[9px]">{x.side}</td></tr>)}</tbody></table> : <Empty>No matching spot/perp trade pairs yet · coincidences are possible</Empty>}</div></Panel>
      <Panel title="MAR-referenced session audit · SHA-256" className="xl:col-span-8" actions={<div className="flex flex-wrap items-center gap-2"><span className="text-[10px] text-muted-foreground" role="status">{audit || e.auditStatus}</span><Button size="sm" variant="outline" onClick={async () => { setAudit('Verifying…'); setAudit(await e.verifyAudit() ? 'Chain verified' : 'Verification failed'); }}><ShieldCheck />Verify chain</Button><Button size="sm" variant="outline" disabled={exporting} onClick={download}><Download />Export CSV</Button></div>}><div className="max-h-56 overflow-auto">{e.ledger.length ? <table className="w-full min-w-[700px] text-[10px]"><tbody>{e.ledger.slice(0, 60).map(r => <tr key={r.id} className="border-b border-border align-top"><td className="py-2 pr-3 text-muted-foreground">{utc(r.ts)}</td><td className="py-2 pr-3 text-warn">{r.type}</td><td className="py-2 pr-3"><div>{r.detail}</div><div className="mt-1 text-[9px] text-muted-foreground">{r.article}</div></td><td className="py-2 text-muted-foreground" title={r.hash}>{r.hash.slice(0, 12)}…</td></tr>)}</tbody></table> : <Empty>No recorded candidate events yet</Empty>}</div></Panel>
    </div>
    <footer className="border-t border-border px-4 py-3 text-[10px] leading-relaxed text-muted-foreground">Public L2 data cannot identify Citadel, Jane Street or any firm, reveal all hidden/OTC orders, or prove market abuse. Fingerprints and timing matches are heuristics; 100ms sampling cannot validate sub-5ms cancellations. Deribit reports exchange-cleared block legs, not every OTC deal. Paper fills are idealized, not executable quotes. SHA-256 covers this browser session’s retained records only; this is not certified MAR compliance.</footer>
  </main>;
}
