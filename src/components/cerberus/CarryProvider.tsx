import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { CarryBot } from '@/lib/cerberus/carryBot';
const CarryContext = createContext<CarryBot | null>(null);
export function CarryProvider({ children }: { children: ReactNode }) {
  const [bot, setBot] = useState<CarryBot | null>(null);
  useEffect(() => { const b = new CarryBot(); setBot(b); b.start(); return () => b.stop(); }, []);
  return <CarryContext.Provider value={bot}>{children}</CarryContext.Provider>;
}
export function useCarry() {
  const bot = useContext(CarryContext);
  const [, update] = useState(0);
  useEffect(() => bot?.subscribe(() => update(n => n + 1)), [bot]);
  return bot;
}