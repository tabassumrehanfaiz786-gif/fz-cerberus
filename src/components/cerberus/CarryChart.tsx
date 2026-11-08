import { useId } from 'react';
import type { EquityPoint } from '@/lib/cerberus/carryBot';
import { usd } from './CarryShared';
export function CarryChart({ points }: { points: EquityPoint[] }) {
  const id = useId();
  if (points.length < 2) return <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">Collecting live equity observations…</div>;
  const values = points.flatMap(p => [p.net, p.spot, p.treasury]);
  const low = Math.min(...values) - 5, high = Math.max(...values) + 5;
  const path = (key: 'net' | 'spot' | 'treasury') => points.map((p, i) => `${i ? 'L' : 'M'}${60 + i / (points.length - 1) * 900},${220 - (p[key] - low) / (high - low) * 190}`).join(' ');
  return <div className="px-4 py-4"><div className="mb-4 flex flex-wrap gap-4 text-[10px]"><span className="text-bid">━ Paper net equity</span><span className="text-muted-foreground">━ Unhedged allocation benchmark</span><span className="text-warn">━ Assumed treasury hurdle</span></div><svg viewBox="0 0 1000 260" className="h-64 w-full" role="img" aria-labelledby={id}><title id={id}>Live paper equity compared with unhedged spot and assumed treasury benchmark</title>{[0, 1, 2, 3].map(i => <g key={i}><line x1="60" x2="960" y1={30 + i * 63} y2={30 + i * 63} stroke="var(--border)" /><text x="0" y={34 + i * 63} fill="var(--muted-foreground)" fontSize="10">{usd(high - i / 3 * (high - low))}</text></g>)}<path d={path('spot')} stroke="var(--muted-foreground)" fill="none" strokeWidth="1.5" /><path d={path('treasury')} stroke="var(--warn)" fill="none" strokeWidth="1.5" /><path d={path('net')} stroke="var(--bid)" fill="none" strokeWidth="2" /><text x="60" y="250" fill="var(--muted-foreground)" fontSize="11">{new Date(points[0].ts).toISOString().slice(11, 19)} UTC</text><text x="860" y="250" fill="var(--muted-foreground)" fontSize="11">{new Date(points.at(-1)?.ts ?? 0).toISOString().slice(11, 19)} UTC</text></svg></div>;
}