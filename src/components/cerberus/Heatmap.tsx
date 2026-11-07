import { useEffect, useRef } from "react";
import type { CerberusEngine } from "@/lib/cerberus/engine";

export function Heatmap({ engine, mode = "depth", range = 300 }: { engine: CerberusEngine; mode?: "depth" | "mm"; range?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(c);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const colors = { bg: token('--canvas-background'), axis: token('--canvas-axis'), text: token('--canvas-text'), bid: token('--bid'), mm: token('--mm'), warn: token('--warn'), perp: token('--perp'), fg: token('--foreground'), low: token('--depth-low') };
    const alpha = (color: string, opacity: number) => `color-mix(in oklch, ${color} ${Math.max(0, Math.min(1, opacity)) * 100}%, transparent)`;
    const ramp = (x: number) => `color-mix(in oklch, ${colors.bid} ${Math.max(0, Math.min(1, x)) * 100}%, ${colors.low})`;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, last = performance.now(), fps = 60;
    const draw = (now: number) => {
      fps = fps * 0.9 + (1000 / Math.max(1, now - last)) * 0.1; last = now;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
      const cols = engine.columns;
      const mid = engine.mid(engine.spot);
      if (!cols.length || !mid) {
        ctx.fillStyle = colors.text; ctx.font = "12px monospace";
        ctx.fillText("Awaiting Coinbase depth stream…", 20, 30);
        raf = requestAnimationFrame(draw); return;
      }
      const pTop = mid + range, pBot = mid - range;
      const y = (p: number) => ((pTop - p) / (pTop - pBot)) * H;
      const plotW = Math.max(1, W - 70);
      const cw = Math.max(2, plotW / engine.maxCols); // narrow screens show fewer, wider columns
      const x0 = plotW - cols.length * cw;
      const rowH = Math.max(2, (engine.bucket / (pTop - pBot)) * H);
      const nowMs = Date.now();
      const tx = (t: number) => plotW - ((nowMs - t) / 500) * cw;
      let maxQ = 1;
      for (const [, q] of cols.at(-1)?.levels ?? []) maxQ = Math.max(maxQ, q);
      maxQ = Math.max(maxQ, ...engine.walls.map((w) => w.q));
      cols.forEach((col, i) => {
        const x = x0 + i * cw;
        if (mode === "depth") for (const [p, q] of col.levels) {
          if (p > pTop || p < pBot) continue;
          ctx.fillStyle = ramp(Math.sqrt(q / maxQ));
          ctx.fillRect(x, y(p) - rowH / 2, cw + 0.5, rowH);
        }
        for (const [p, q] of col.mmLevels) {
          if (p > pTop || p < pBot) continue;
          ctx.fillStyle = alpha(colors.mm, mode === "mm" ? Math.min(1, 0.25 + Math.sqrt(q / maxQ)) : Math.min(0.9, 0.3 + q / maxQ));
          ctx.fillRect(x, y(p) - rowH / 2, cw + 0.5, rowH);
        }
      });
      // Aggressive market-order bubbles (taker fills), sized by sqrt(BTC)
      for (const b of engine.bubbles) {
        if ((mode === "depth" && b.venue === "perp") || b.p > pTop || b.p < pBot) continue;
        const bx = tx(b.t); if (bx < 0) continue;
        const r = Math.min(18, 2 + Math.sqrt(b.q) * 6);
        ctx.beginPath(); ctx.arc(bx, y(b.p), r, 0, Math.PI * 2);
        ctx.fillStyle = alpha(b.takerSell ? colors.mm : colors.bid, 0.6);
        ctx.fill();
        ctx.strokeStyle = b.venue === "perp" ? colors.perp : colors.fg; ctx.lineWidth = b.hit ? 2 : 0.6; ctx.stroke(); ctx.lineWidth = 1;
        if (b.hit || b.q >= 1) {
          ctx.fillStyle = b.hit ? colors.warn : colors.fg; ctx.font = "9px monospace";
          ctx.fillText(`${b.hit ? b.hit + " " : ""}${b.q.toFixed(2)} BTC`, Math.min(bx + r + 2, plotW - 85), y(b.p) + 3);
        }
      }
      // Top wall tags (MM view)
      if (mode === "mm") {
        ctx.font = "10px monospace";
        for (const side of ["bid", "ask"] as const) {
          engine.walls.filter((w) => w.side === side).slice(0, 3).forEach((w) => {
            if (w.p > pTop || w.p < pBot) return;
            const label = `${side.toUpperCase()} ${w.q.toFixed(1)} BTC · $${(w.usd / 1000).toFixed(0)}K ${w.tags[0] ?? ''}`;
            const width = Math.min(plotW - 8, 330), x = plotW - width - 4;
            ctx.fillStyle = alpha(colors.bg, 0.85); ctx.fillRect(x, y(w.p) - 8, width, 13);
            ctx.fillStyle = side === "bid" ? colors.bid : colors.mm;
            ctx.save(); ctx.beginPath(); ctx.rect(x, y(w.p) - 8, width, 13); ctx.clip(); ctx.fillText(label, x + 2, y(w.p) + 2); ctx.restore();
          });
        }
      }
      // mid line
      ctx.strokeStyle = colors.fg; ctx.lineWidth = 1; ctx.beginPath();
      cols.forEach((col, i) => { const yy = y(col.mid); i ? ctx.lineTo(x0 + i * cw, yy) : ctx.moveTo(x0, yy); });
      ctx.stroke();
      if (mode === 'depth') {
        const micro = engine.micro(engine.spot);
        ctx.strokeStyle = colors.perp; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(Math.max(0, plotW - 150), y(micro)); ctx.lineTo(plotW, y(micro)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (mode === 'mm') {
        for (const leg of engine.blocks.visible.filter(l => !l.historical && l.kind === 'future' && Date.now() - l.received < 30000).slice(0, 4)) {
          if (leg.underlying < pBot || leg.underlying > pTop) continue;
          const yy = y(leg.underlying);
          ctx.fillStyle = alpha(colors.warn, 0.18); ctx.fillRect(0, yy - 6, plotW, 12);
          ctx.fillStyle = colors.warn; ctx.font = '10px monospace';
          ctx.fillText(`BLOCK LEG ${leg.btc.toFixed(1)} BTC · $${(leg.usd / 1000).toFixed(0)}K`, 8, yy + 3);
        }
      }
      // Skew ribbon: band between mid and A-S reservation price
      const res = engine.bot.res;
      if (res) {
        const g = ctx.createLinearGradient(plotW - 200, 0, plotW, 0);
        const col = engine.inferredQ > 0 ? colors.mm : colors.bid;
        g.addColorStop(0, alpha(col, 0)); g.addColorStop(1, alpha(col, 0.45));
        ctx.fillStyle = g;
        const skewPx = Math.max(3, Math.abs(engine.inferredQ) * 12);
        ctx.fillRect(plotW - 200, y(mid) - skewPx / 2, 200, skewPx);
        // bot quotes
        ctx.setLineDash([4, 3]); ctx.strokeStyle = colors.warn;
        for (const p of [engine.bot.bid, engine.bot.ask]) { ctx.beginPath(); ctx.moveTo(plotW - 120, y(p)); ctx.lineTo(plotW, y(p)); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // Toxic retreat ghost boxes
      const t = Date.now();
      for (const r of engine.retreats) {
        const age = (t - r.born) / 4000; if (age > 1) continue;
        ctx.strokeStyle = alpha(r.toxic ? colors.mm : colors.text, 1 - age);
        ctx.setLineDash([3, 3]);
        const yt = y(r.pMax) - 3, yb = y(r.pMin) + 3;
        ctx.strokeRect(plotW - 160 - age * 120, Math.min(yt, yb), 90, Math.abs(yb - yt) + 2);
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle; ctx.font = "10px monospace";
        ctx.fillText(`${r.toxic ? "TOXIC? " : ""}-${r.qty.toFixed(1)} BTC ${r.dt}ms`, Math.max(4, plotW - 155 - age * 120), Math.min(yt, yb) - 3);
      }
      // Echo arcs: spot (left lane) → perp (right axis)
      const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 120);
      for (const e of engine.echoes) {
        const age = (t - e.born) / 3000; if (age > 1) continue;
        const ys = y(e.spot.p), yp = y(e.perp.p);
        const xs = plotW - 60, xp = W - 8;
        ctx.strokeStyle = alpha(colors.mm, (1 - age) * (0.5 + 0.5 * pulse));
        ctx.lineWidth = 2 + pulse * 2;
        ctx.beginPath(); ctx.moveTo(xs, ys);
        ctx.quadraticCurveTo((xs + xp) / 2, Math.min(ys, yp) - 40, xp, yp); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = alpha(colors.fg, 1 - age); ctx.font = "10px monospace";
        ctx.fillText(`${e.latency}ms`, (xs + xp) / 2 - 12, Math.min(ys, yp) - 22);
      }
      // price axis
      ctx.fillStyle = colors.axis; ctx.fillRect(plotW, 0, 70, H);
      ctx.fillStyle = colors.text; ctx.font = "10px monospace";
      for (let i = 0; i <= 10; i++) { const p = pBot + ((pTop - pBot) * i) / 10; ctx.fillText(p.toFixed(1), plotW + 4, y(p) + 3); }
      ctx.fillStyle = colors.text;
      ctx.fillText(`${fps.toFixed(0)} FPS`, 8, 14);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, mode, range]);
  return <canvas ref={ref} aria-label={mode === 'mm' ? 'Large passive order walls and block ribbons' : 'Passive depth and micro-price'} className="block h-full w-full" />;
}
