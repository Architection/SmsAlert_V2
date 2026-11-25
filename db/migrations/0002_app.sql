-- SMS Alerts egne tabeller, som schema.sql havde dem i Supabase (Postgres) indtil november 2026.
--
-- Tider er ISO 8601-tekst i UTC med millisekunder ("2026-11-25T17:45:00.123Z"), både dem appen
-- skriver (new Date().toISOString()) og standardværdierne her. Alle tider SKAL have den form:
-- de sammenlignes som tekst (dagens historik, arkivets vandmærke, kampagnens perioder), og
-- arkivets unikke (phone, ordered_at) kræver, at samme tidspunkt altid skrives ens.

-- Ordrer ----------------------------------------------------------------
create table orders (
  id           text primary key,                -- uuid, sat af appen
  order_no     integer,                         -- fortløbende ordrenummer (vises i SMS)
  phone        text not null,                   -- kundens mobilnummer (som indtastet)
  name         text,                            -- valgfrit navn / note på ordren
  lead_minutes integer not null default 10,     -- minutter før færdig der ønskes SMS
  ready_at     text not null,                   -- aftalt ca. færdig-tidspunkt
  status       text not null default 'active'
                 check (status in ('active', 'sent', 'done', 'cancelled')),
  sms_sent_at  text,                            -- hvornår SMS faktisk blev sendt
  sms_body     text,                            -- den tekst der blev sendt
  deleted_at   text,                            -- blød sletning: vises under Historik → Slettet
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index orders_status_idx     on orders (status);
create index orders_created_at_idx on orders (created_at);
create index orders_deleted_at_idx on orders (deleted_at);

-- Indstillinger (én enkelt række) --------------------------------------
create table settings (
  id                   integer primary key default 1 check (id = 1),
  sms_template         text not null,
  sender_name          text not null,
  next_order_no        integer not null default 1,  -- nummeret den næste nye ordre får
  archive_last_sync_at text,                        -- hvornår "Hent seneste ordrer" sidst kørte
  updated_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Standard-indstillinger. Pladsholdere: {minutter} {tid} {navn} {ordreno}
insert into settings (id, sms_template, sender_name)
values (
  1,
  'Hej! Din ordre er snart klar – ca. kl. {tid} (om {minutter} min.). Oplys ordrenummer {ordreno}. Vi glæder os til at se dig!',
  'Restaurant'
);

-- SMS-arkiv (Kampagne) -------------------------------------------------
-- Numre + bestillingstidspunkt, kun til marketing, adskilt fra orders. Fyldes fra det gamle
-- systems engangsimport og fra "Hent seneste ordrer". AUTOINCREMENT, så et id aldrig bruges
-- igen (som Postgres' identity).
create table sms_archive (
  id         integer primary key autoincrement,
  phone      text not null,                     -- kun cifre med landekode, fx 4540184636
  ordered_at text not null,                     -- hvornår bestillingen blev oprettet
  source     text not null default 'orders' check (source in ('import', 'orders')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Samme nummer + samme tidspunkt = samme bestilling (on conflict do nothing).
create unique index sms_archive_phone_ordered_idx on sms_archive (phone, ordered_at);
create index sms_archive_phone_idx      on sms_archive (phone);
create index sms_archive_ordered_at_idx on sms_archive (ordered_at);
