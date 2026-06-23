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

-- SMS-arkiv (Kampagne) -------------------------------------------------
-- Lille, selvstændig tabel kun til marketing: numre + bestillingsdato.
-- Helt adskilt fra public.orders, så ordrer kan slettes uden at miste
-- marketing-datagrundlaget. Fyldes fra (a) engangs-import af det gamle
-- system og (b) "Hent seneste ordrer"-knappen der trækker fra orders.
create table if not exists public.sms_archive (
  id          bigint generated always as identity primary key,
  phone       text not null,                 -- normaliseret msisdn, fx 4540184636
  ordered_at  timestamptz not null,          -- hvornår bestillingen blev oprettet
  source      text not null default 'orders' -- 'import' (gammelt system) | 'orders' (live)
                check (source in ('import','orders')),
  created_at  timestamptz not null default now() -- hvornår rækken kom i arkivet
);

-- Samme nummer + samme bestillingstidspunkt = samme bestilling. Gør både
-- engangs-import og gentagne "hent seneste" idempotente (on conflict do nothing).
create unique index if not exists sms_archive_phone_ordered_idx
  on public.sms_archive (phone, ordered_at);
create index if not exists sms_archive_phone_idx      on public.sms_archive (phone);
create index if not exists sms_archive_ordered_at_idx on public.sms_archive (ordered_at);

-- Hvornår "Hent seneste ordrer" sidst blev kørt (vises på Kampagne-siden).
alter table public.settings add column if not exists archive_last_sync_at timestamptz;

-- Nøgletal til Kampagne-siden i ét kald.
create or replace function public.campaign_summary()
returns json
language sql
stable
as $$
  select json_build_object(
    'total_rows',      (select count(*) from public.sms_archive),
    'unique_numbers',  (select count(distinct phone) from public.sms_archive),
    'last_7_days',     (select count(*) from public.sms_archive where ordered_at >= now() - interval '7 days'),
    'last_30_days',    (select count(*) from public.sms_archive where ordered_at >= now() - interval '30 days'),
    'first_order',     (select min(ordered_at) from public.sms_archive),
    'last_order',      (select max(ordered_at) from public.sms_archive),
    'top_numbers',     (select coalesce(json_agg(t), '[]'::json) from (
                          select phone, count(*) as orders, max(ordered_at) as last_order
                          from public.sms_archive
                          group by phone
                          order by count(*) desc, max(ordered_at) desc
                          limit 10
                        ) t)
  );
$$;

-- Unikke numre, aggregeret, med valgfri filtre. Bruges til både visning og CSV-eksport.
create or replace function public.campaign_numbers(
  p_from       timestamptz default null,
  p_to         timestamptz default null,
  p_min_orders integer     default 1,
  p_q          text        default null,
  p_limit      integer     default 1000
)
returns table (
  phone       text,
  orders      bigint,
  first_order timestamptz,
  last_order  timestamptz
)
language sql
stable
as $$
  select phone,
         count(*)        as orders,
         min(ordered_at) as first_order,
         max(ordered_at) as last_order
  from public.sms_archive
  where (p_from is null or ordered_at >= p_from)
    and (p_to   is null or ordered_at <= p_to)
    and (p_q    is null or phone like '%' || p_q || '%')
  group by phone
  having count(*) >= coalesce(p_min_orders, 1)
  order by orders desc, last_order desc
  limit coalesce(p_limit, 1000);
$$;
