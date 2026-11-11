import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const money = (n: number) => `${n >= 0 ? '+' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function CloudDeskPanel() {
  const { data } = useQuery({
    queryKey: ['cloud-desk'], refetchInterval: 60_000,
    queryFn: async () => {
      const [pos, eq, ev] = await Promise.all([
        supabase.from('cloud_positions').select('*').is('closed_at', null).order('opened_at'),
        supabase.from('cloud_equity').select('*').order('ts', { ascending: false }).limit(200),
        supabase.from('cloud_events').select('*').order('ts', { ascending: false }).limit(15),
      ]);
      return { pos: pos.data ?? [], eq: (eq.data ?? []).reverse(), ev: ev.data ?? [] };
    },
  });
  const last = data?.eq.at(-1);
  const pts = data?.eq ?? [];
  const lo = Math.min(...pts.map(p => p.equity), 100_000), hi = Math.max(...pts.map(p => p.equity), 100_000);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1)) * 100},${40 - ((p.equity - lo) / Math.max(1e-9, hi - lo)) * 36 - 2}`).join(' ');
  const pnl = last ? last.equity - 100_000 : 0;
  return (
    <section className="border-b-2 border-bid/60 bg-bid/5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-bid" />
        <h2 className="text-sm font-bold text-bid">CLOUD BOT · RUNS 24/7</h2>
        <span className="text-[10px] text-muted-foreground">Keeps trading on paper every 15 min, even when this app is closed · $100,000 simulated · no real orders</span>
      </div>
      {!last ? <p className="mt-3 text-xs text-muted-foreground">Waiting for the first cloud run (within 15 minutes)…</p> : <>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs lg:grid-cols-5">
          <div><div className="text-[10px] text-muted-foreground">Cloud equity</div><div className="text-lg font-bold">{last.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
          <div><div className="text-[10px] text-muted-foreground">Profit / loss</div><div className={`text-lg font-bold ${pnl >= 0 ? 'text-bid' : 'text-mm'}`}>{money(pnl)}</div></div>
          <div><div className="text-[10px] text-muted-foreground">Funding earned</div><div className={last.funding >= 0 ? 'text-bid' : 'text-mm'}>{money(last.funding)}</div></div>
          <div><div className="text-[10px] text-muted-foreground">Fees paid</div><div className="text-mm">{money(-last.costs)}</div></div>
          <div><div className="text-[10px] text-muted-foreground">Open hedges</div><div>{last.open_count} / 10 · {new Date(last.ts).toISOString().slice(11, 16)} UTC</div></div>
        </div>
        {pts.length > 1 && <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-24 w-full"><path d={path} fill="none" className={pnl >= 0 ? 'stroke-bid' : 'stroke-mm'} strokeWidth="0.6" vectorEffect="non-scaling-stroke" /></svg>}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div><div className="mb-1 text-[10px] text-muted-foreground">CLOUD HEDGES</div>{data!.pos.map(p => { const m = p.last_spot && p.last_perp ? p.qty * (p.last_spot - p.entry_spot) + p.qty * (p.entry_perp - p.last_perp) : 0; return <div key={p.id} className="flex justify-between border-b border-border py-1 text-xs"><span className="font-semibold">{p.asset}</span><span className="text-muted-foreground">funding {money(p.funding_paid)}</span><span className={m >= 0 ? 'text-bid' : 'text-mm'}>basis {money(m)}</span></div>; })}</div>
          <div><div className="mb-1 text-[10px] text-muted-foreground">LATEST CLOUD EVENTS</div>{data!.ev.map(e => <div key={e.id} className="flex justify-between gap-2 border-b border-border py-1 text-[11px]"><span className="text-muted-foreground">{new Date(e.ts).toISOString().slice(5, 16).replace('T', ' ')}</span><span className="flex-1 truncate">{e.type} · {e.detail}</span>{e.amount != null && <span className={e.amount >= 0 ? 'text-bid' : 'text-mm'}>{money(e.amount)}</span>}</div>)}</div>
        </div>
      </>}
      <p className="mt-3 text-[10px] text-muted-foreground">Funding is credited only from exchange-reported settled rates, valued at the current mark (an estimate). Fees are assumed. Profit is not guaranteed; funding can turn negative.</p>
    </section>
  );
}
