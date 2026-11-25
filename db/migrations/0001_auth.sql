-- Better Auths tabeller: login med e-mail og adgangskode, som med Supabase Auth før. Kolonnerne er
-- dem, Better Auth 1.7 forventer uden plugins. Ingen kan oprette sig selv; brugere laves med
-- `npm run user` (scripts/user.mjs).
--
-- Tider er ISO 8601-tekst i UTC med millisekunder, som Better Auth skriver dem i SQLite
-- (Date.toISOString()). Appens egne tabeller (0002_app.sql) bruger samme form.
--
-- Brugerne fra Supabase beholder deres id (en uuid) og deres bcrypt-adgangskode ("$2a$..."), som
-- skrives om til Better Auths egen slags, første gang de logger ind (api/_lib/auth.js).
-- "name" er delen før @ i e-mailen; Supabase havde intet navn på brugeren.

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  -- Adgangskodens hash. Brugerne fra Supabase har deres bcrypt-hash her, til de logger ind igen
  -- (checkPassword i api/_lib/auth-engine.js).
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

-- Better Auth vil have tabellen, selv om SMS Alert ikke sender mails.
create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Forsøg på at logge ind, til grænserne i api/_lib/auth.js, som Supabase Auth stod for før.
-- Gamle rækker slettes ved næste forsøg.
create table login_attempts (
  key text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index login_attempts_idx on login_attempts (key, created_at);
