import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CerberusEngine } from "@/lib/cerberus/engine";
import { Heatmap } from "@/components/cerberus/Heatmap";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Project Cerberus — MM & Delta-Neutral Hedging Terminal" },
      { name: "description", content: "Live Coinbase spot/perp liquidity heatmap, market-maker surveillance, Avellaneda-Stoikov paper bot and MAR Art.12 audit ledger." },
      { property: "og:title", content: "Project Cerberus Terminal" },
      { property: "og:description", content: "Institutional market maker surveillance and delta-neutral hedging terminal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Terminal,
});

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "warn" | undefined }) {
  const c = tone === "up" ? "text-bid" : tone === "down" ? "text-mm" : tone === "warn" ? "text-warn" : "text-foreground";
  return (
    <div className="border-r border-border px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col border border-border bg-card ${className}`}>
      <h2 className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</h2>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}

function Equity({ data }: { data: { v: number }[] }) {
  if (data.length < 2) return <div className="p-4 text-xs text-muted-foreground">Accumulating fills…</div>;
  const min = Math.min(...data.map((d) => d.v)), max = Math.max(...data.map((d) => d.v));
  const span = max - min || 1;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${40 - ((d.v - min) / span) * 38 - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full">
      <polyline points={pts} fill="none" stroke="var(--bid)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Terminal() {
  const [engine, setEngine] = useState<CerberusEngine | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const e = new CerberusEngine();
    e.start();
    setEngine(e);
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => { clearInterval(id); e.stop(); };
  }, []);

  if (!engine) return <div className="flex h-screen items-center justify-center font-mono text-muted-foreground">Booting Cerberus…</div>;
  const e = engine;
  const mid = e.mid(e.spot), pmid = e.mid(e.perp);
  const basis = pmid && mid ? pmid - mid : 0;
  const q = e.inferredQ;
  const pnl = e.bot.equity;
  const download = () => {
    const url = URL.createObjectURL(new Blob([e.exportCsv()], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `cerberus-mar-ledger-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex h-screen flex-col bg-background font-mono text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-4 py-2">
        <h1 className="text-sm font-bold tracking-[0.3em]">
          CERBERUS<span className="text-mm">▲</span>
        </h1>
        <span className="text-[10px] text-muted-foreground">INSTITUTIONAL MM / DELTA-NEUTRAL HEDGING · COINBASE BTC-USD / BTC PERP</span>
        <div className="ml-auto flex gap-3 text-[10px]">
          {(["spot", "perp"] as const).map((v) => (
            <span key={v} className={e.status[v] === "live" ? "text-bid" : "text-warn"}>
              ● {v.toUpperCase()} {e.status[v]} {e.status[v === "spot" ? "spotLat" : "perpLat"]}ms
            </span>
          ))}
        </div>
      </header>
      <div className="flex flex-wrap border-b border-border">
        <Stat label="Spot mid" value={mid.toFixed(2)} />
        <Stat label="Perp mid" value={pmid.toFixed(2)} />
        <Stat label="Basis" value={basis.toFixed(2)} tone={basis >= 0 ? "up" : "down"} />
        <Stat label="σ ($/√s)" value={e.sigma.toFixed(3)} />
        <Stat label="MM inv (A-S inferred)" value={`${q >= 0 ? "LONG" : "SHORT"} ${Math.abs(q).toFixed(2)}`} tone={Math.abs(q) > 1 ? "warn" : undefined} />
        <Stat label="Echoes" value={String(e.echoes.length)} tone="down" />
        <Stat label="Toxic retreats" value={String(e.retreats.filter((r) => r.toxic).length)} tone="down" />
        <Stat label="Net Δ" value={`${e.netDelta().toFixed(2)} BTC`} tone="up" />
        <Stat label="Paper P&L" value={`$${pnl.toFixed(2)}`} tone={pnl >= 0 ? "up" : "down"} />
        <Stat label="Sharpe (ann.)" value={e.sharpe().toFixed(1)} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-6 gap-px bg-border">
        <section className="col-span-9 row-span-4 grid min-h-0 grid-rows-2 gap-px">
          <Panel title="Passive liquidity heatmap · Coinbase BTC-USD depth (emerald) · echo arcs → perp">
            <div className="h-full"><Heatmap engine={e} /></div>
          </Panel>
          <Panel title="Market maker heatmap · large resting walls & spot/perp mirrored quotes (crimson)">
            <div className="h-full"><Heatmap engine={e} mode="mm" /></div>
          </Panel>
        </section>
        <Panel title="A-S quoting bot" className="col-span-3 row-span-2">
          <div className="grid grid-cols-2 gap-1 text-xs">
            <span className="text-muted-foreground">Bid</span><span className="text-bid">{e.bot.bid.toFixed(2)}</span>
            <span className="text-muted-foreground">Ask</span><span className="text-mm">{e.bot.ask.toFixed(2)}</span>
            <span className="text-muted-foreground">Reservation</span><span>{e.bot.res.toFixed(2)}</span>
            <span className="text-muted-foreground">Spot inv</span><span>{e.bot.q.toFixed(2)}</span>
            <span className="text-muted-foreground">Perp hedge</span><span>{e.bot.hedge.toFixed(2)}</span>
            <span className="text-muted-foreground">Fills</span><span>{e.bot.fills}</span>
            <span className="text-muted-foreground">Spread captured</span><span className="text-bid">${e.bot.spreadPnl.toFixed(2)}</span>
          </div>
          <button onClick={() => (e.bot.enabled = !e.bot.enabled)} className="mt-2 w-full border border-border py-1 text-[10px] uppercase tracking-widest hover:bg-accent">
            {e.bot.enabled ? "Halt bot" : "Resume bot"}
          </button>
        </Panel>
        <Panel title="Paper equity curve (mark-to-market)" className="col-span-3 row-span-2">
          <Equity data={e.equity} />
        </Panel>
        <Panel title="Echo matcher · spot maker ↔ perp taker 10–50ms" className="col-span-4 row-span-2">
          <table className="w-full text-[10px]">
            <tbody>
              {e.echoes.slice(-30).reverse().map((x) => (
                <tr key={x.id} className="border-b border-border/50">
                  <td className="text-muted-foreground">{new Date(x.spot.t).toISOString().slice(11, 23)}</td>
                  <td>{x.spot.q.toFixed(3)}₿</td>
                  <td className="text-mm">{x.latency}ms</td>
                  <td>{x.side}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="MAR Art.12 compliance audit ledger (hash-chained)" className="col-span-8 row-span-2">
          <div className="mb-1 flex justify-end">
            <button onClick={download} className="border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest hover:bg-accent">Export CSV</button>
          </div>
          <table className="w-full text-[10px]">
            <tbody>
              {e.ledger.slice(0, 60).map((r) => (
                <tr key={r.id} className="border-b border-border/50 align-top">
                  <td className="pr-2 text-muted-foreground">{new Date(r.ts).toISOString().slice(11, 23)}</td>
                  <td className={`pr-2 ${r.type === "BOT_FILL" ? "text-warn" : "text-mm"}`}>{r.type}</td>
                  <td className="pr-2 text-muted-foreground">{r.article}</td>
                  <td className="pr-2">{r.detail}</td>
                  <td className="text-muted-foreground">{r.hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <footer className="border-t border-border px-4 py-1 text-[9px] text-muted-foreground">
        Surveillance flags are statistical heuristics on public data; they do not identify specific firms. Bot is paper-only. Data: Coinbase Advanced Trade public feed (BTC-USD spot, BIP-20DEC30-CDE perpetual). Book sampled every 100ms; retreat timing uses exchange event timestamps.
      </footer>
    </main>
  );
}
