import { useEffect, useRef } from "react";
import type { CerberusEngine } from "@/lib/cerberus/engine";

// Canvas palette is fixed by spec (emerald depth ramp, crimson MM overlays).
const ramp = (x: number) => {
  // #052e16 -> #10b981
  const a = [5, 46, 22], b = [16, 185, 129];
  const t = Math.min(1, Math.max(0, x));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(",")})`;
};

export function Heatmap({ engine, mode = "depth" }: { engine: CerberusEngine; mode?: "depth" | "mm" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0, last = performance.now(), fps = 60;
    const draw = (now: number) => {
      fps = fps * 0.9 + (1000 / Math.max(1, now - last)) * 0.1; last = now;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#020617"; ctx.fillRect(0, 0, W, H);
      const cols = engine.columns;
      const mid = engine.mid(engine.spot);
      if (!cols.length || !mid) {
        ctx.fillStyle = "#64748b"; ctx.font = "12px monospace";
        ctx.fillText("Awaiting Coinbase depth stream…", 20, 30);
        raf = requestAnimationFrame(draw); return;
      }
      const range = mode === "mm" ? 150 : Math.min(120, Math.max(40, engine.sigma * 8));
      const pTop = mid + range, pBot = mid - range;
      const y = (p: number) => ((pTop - p) / (pTop - pBot)) * H;
      const plotW = W - 70;
      const cw = plotW / engine.maxCols;
      const x0 = plotW - cols.length * cw;
      const rowH = Math.max(2, (engine.bucket / (pTop - pBot)) * H);
      const nowMs = Date.now();
      const tx = (t: number) => plotW - ((nowMs - t) / 500) * cw;
      let maxQ = 1;
      for (const [, q] of cols[cols.length - 1]!.levels) maxQ = Math.max(maxQ, q);
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
          ctx.fillStyle = mode === "mm" ? `rgba(239,68,68,${Math.min(1, 0.25 + Math.sqrt(q / maxQ))})` : `rgba(239,68,68,${Math.min(0.9, 0.3 + q / maxQ)})`;
          ctx.fillRect(x, y(p) - rowH / 2, cw + 0.5, rowH);
        }
      });
      // Aggressive market-order bubbles (taker fills), sized by sqrt(BTC)
      for (const b of engine.bubbles) {
        if ((mode === "depth" && b.venue === "perp") || b.p > pTop || b.p < pBot) continue;
        const bx = tx(b.t); if (bx < 0) continue;
        const r = Math.min(18, 2 + Math.sqrt(b.q) * 6);
        ctx.beginPath(); ctx.arc(bx, y(b.p), r, 0, Math.PI * 2);
        ctx.fillStyle = b.takerSell ? "rgba(239,68,68,0.55)" : "rgba(16,185,129,0.6)";
        ctx.fill();
        ctx.strokeStyle = b.venue === "perp" ? "#38bdf8" : "#e2e8f0"; ctx.lineWidth = b.hit ? 2 : 0.6; ctx.stroke(); ctx.lineWidth = 1;
        if (b.hit || b.q >= 1) {
          ctx.fillStyle = b.hit ? "#facc15" : "#e2e8f0"; ctx.font = "9px monospace";
          ctx.fillText(`${b.hit ? b.hit + " " : ""}${b.q.toFixed(2)}₿`, bx + r + 2, y(b.p) + 3);
        }
      }
      // Top wall tags (MM view)
      if (mode === "mm") {
        ctx.font = "10px monospace";
        for (const side of ["bid", "ask"] as const) {
          engine.walls.filter((w) => w.side === side).slice(0, 3).forEach((w) => {
            if (w.p > pTop || w.p < pBot) return;
            const label = `${side.toUpperCase()} WALL ${w.q.toFixed(1)}₿ @ ${w.p}`;
            ctx.fillStyle = "rgba(2,6,23,0.8)"; ctx.fillRect(plotW - 190, y(w.p) - 8, 186, 12);
            ctx.fillStyle = side === "bid" ? "#10b981" : "#ef4444";
            ctx.fillText(label, plotW - 186, y(w.p) + 2);
          });
        }
      }
      // mid line
      ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1; ctx.beginPath();
      cols.forEach((col, i) => { const yy = y(col.mid); i ? ctx.lineTo(x0 + i * cw, yy) : ctx.moveTo(x0, yy); });
      ctx.stroke();
      // Skew ribbon: band between mid and A-S reservation price
      const res = engine.bot.res;
      if (res) {
        const g = ctx.createLinearGradient(plotW - 200, 0, plotW, 0);
        const col = engine.inferredQ > 0 ? "239,68,68" : "16,185,129";
        g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.45)`);
        ctx.fillStyle = g;
        const skewPx = Math.max(3, Math.abs(engine.inferredQ) * 12);
        ctx.fillRect(plotW - 200, y(mid) - skewPx / 2, 200, skewPx);
        // bot quotes
        ctx.setLineDash([4, 3]); ctx.strokeStyle = "#facc15";
        for (const p of [engine.bot.bid, engine.bot.ask]) { ctx.beginPath(); ctx.moveTo(plotW - 120, y(p)); ctx.lineTo(plotW, y(p)); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // Toxic retreat ghost boxes
      const t = Date.now();
      for (const r of engine.retreats) {
        const age = (t - r.born) / 4000; if (age > 1) continue;
        ctx.strokeStyle = r.toxic ? `rgba(239,68,68,${1 - age})` : `rgba(148,163,184,${0.7 - age * 0.7})`;
        ctx.setLineDash([3, 3]);
        const yt = y(r.pMax) - 3, yb = y(r.pMin) + 3;
        ctx.strokeRect(plotW - 160 - age * 120, Math.min(yt, yb), 90, Math.abs(yb - yt) + 2);
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle; ctx.font = "10px monospace";
        ctx.fillText(`${r.toxic ? "TOXIC " : ""}-${r.qty.toFixed(1)}₿ ${r.dt}ms`, plotW - 155 - age * 120, Math.min(yt, yb) - 3);
      }
      // Echo arcs: spot (left lane) → perp (right axis)
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      for (const e of engine.echoes) {
        const age = (t - e.born) / 3000; if (age > 1) continue;
        const ys = y(e.spot.p), yp = y(e.perp.p);
        const xs = plotW - 60, xp = W - 8;
        ctx.strokeStyle = `rgba(239,68,68,${(1 - age) * (0.5 + 0.5 * pulse)})`;
        ctx.lineWidth = 2 + pulse * 2;
        ctx.beginPath(); ctx.moveTo(xs, ys);
        ctx.quadraticCurveTo((xs + xp) / 2, Math.min(ys, yp) - 40, xp, yp); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = `rgba(254,202,202,${1 - age})`; ctx.font = "10px monospace";
        ctx.fillText(`${e.latency}ms`, (xs + xp) / 2 - 12, Math.min(ys, yp) - 22);
      }
      // price axis
      ctx.fillStyle = "#0f172a"; ctx.fillRect(plotW, 0, 70, H);
      ctx.fillStyle = "#94a3b8"; ctx.font = "10px monospace";
      for (let i = 0; i <= 10; i++) { const p = pBot + ((pTop - pBot) * i) / 10; ctx.fillText(p.toFixed(1), plotW + 4, y(p) + 3); }
      ctx.fillStyle = "#64748b";
      ctx.fillText(`${fps.toFixed(0)} FPS`, 8, 14);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, mode]);
  return <canvas ref={ref} className="h-full w-full" />;
}
