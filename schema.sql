-- SMS Alert – Supabase skema
-- Kør dette i Supabase Studio → SQL Editor (én gang ved opsætning).

-- Ordrer ----------------------------------------------------------------
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     integer,                       -- fortløbende, unikt ordrenummer (vises i SMS)
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

-- Migration for eksisterende installationer.
alter table public.orders add column if not exists order_no integer;

create index if not exists orders_status_idx     on public.orders (status);
create index if not exists orders_created_at_idx  on public.orders (created_at);

-- Indstillinger (én enkelt række) --------------------------------------
create table if not exists public.settings (
  id            integer primary key default 1 check (id = 1),
  sms_template  text not null,
  sender_name   text not null,
  next_order_no integer not null default 1,   -- nummeret den næste nye ordre får tildelt
  updated_at    timestamptz not null default now()
);

-- Migration for eksisterende installationer.
alter table public.settings add column if not exists next_order_no integer not null default 1;

-- Tildel det næste ordrenummer atomisk og rul tælleren én frem.
-- Returnerer nummeret der blev tildelt. UPDATE'et tager rækkelås, så to
-- samtidige ordrer aldrig får samme nummer.
create or replace function public.next_order_number()
returns integer
language plpgsql
as $$
declare
  assigned integer;
begin
  update public.settings
     set next_order_no = next_order_no + 1
   where id = 1
   returning next_order_no - 1 into assigned;
  return assigned;
end;
$$;

-- Standard-indstillinger. Pladsholdere: {minutter} {tid} {navn} {ordreno}
insert into public.settings (id, sms_template, sender_name)
values (
  1,
  'Hej! Din ordre er snart klar – ca. kl. {tid} (om {minutter} min.). Oplys ordrenummer {ordreno}. Vi glæder os til at se dig!',
  'Restaurant'
)
on conflict (id) do nothing;
