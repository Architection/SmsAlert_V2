-- SMS Alert – Supabase skema
-- Kør dette i Supabase Studio → SQL Editor (én gang ved opsætning).

-- Ordrer ----------------------------------------------------------------
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,                 -- kundens mobilnummer (som indtastet)
  name         text,                          -- valgfrit navn / note på ordren
  lead_minutes integer not null default 10,   -- minutter før færdig der ønskes SMS
  ready_at     timestamptz not null,          -- aftalt ca. færdig-tidspunkt
  status       text not null default 'active' -- active | sent | done | cancelled
                 check (status in ('active','sent','done','cancelled')),
  sms_sent_at  timestamptz,                   -- hvornår SMS faktisk blev sendt
  sms_body     text,                          -- den tekst der blev sendt
  created_at   timestamptz not null default now()
);

create index if not exists orders_status_idx     on public.orders (status);
create index if not exists orders_created_at_idx  on public.orders (created_at);

-- Indstillinger (én enkelt række) --------------------------------------
create table if not exists public.settings (
  id           integer primary key default 1 check (id = 1),
  sms_template text not null,
  sender_name  text not null,
  updated_at   timestamptz not null default now()
);

-- Standard-indstillinger. Pladsholdere: {minutter} {tid} {navn}
insert into public.settings (id, sms_template, sender_name)
values (
  1,
  'Hej! Din ordre er snart klar – ca. kl. {tid} (om {minutter} min.). Vi glæder os til at se dig!',
  'Restaurant'
)
on conflict (id) do nothing;
