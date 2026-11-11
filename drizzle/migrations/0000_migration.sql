CREATE TABLE public.cloud_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  asset text NOT NULL,
  qty double precision NOT NULL,
  entry_spot double precision NOT NULL,
  entry_perp double precision NOT NULL,
  entry_cost double precision NOT NULL DEFAULT 0,
  funding_paid double precision NOT NULL DEFAULT 0,
  last_settlement bigint NOT NULL DEFAULT 0,
  last_spot double precision,
  last_perp double precision,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_reason text,
  realized double precision
);
GRANT SELECT ON public.cloud_positions TO anon, authenticated;
GRANT ALL ON public.cloud_positions TO service_role;
ALTER TABLE public.cloud_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read paper positions" ON public.cloud_positions FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.cloud_events (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  detail text NOT NULL,
  amount double precision
);
GRANT SELECT ON public.cloud_events TO anon, authenticated;
GRANT ALL ON public.cloud_events TO service_role;
GRANT USAGE ON SEQUENCE public.cloud_events_id_seq TO service_role;
ALTER TABLE public.cloud_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read paper events" ON public.cloud_events FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.cloud_equity (
  ts timestamptz PRIMARY KEY DEFAULT now(),
  equity double precision NOT NULL,
  funding double precision NOT NULL,
  costs double precision NOT NULL,
  unrealized double precision NOT NULL,
  open_count int NOT NULL
);
GRANT SELECT ON public.cloud_equity TO anon, authenticated;
GRANT ALL ON public.cloud_equity TO service_role;
ALTER TABLE public.cloud_equity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read paper equity" ON public.cloud_equity FOR SELECT TO anon, authenticated USING (true);