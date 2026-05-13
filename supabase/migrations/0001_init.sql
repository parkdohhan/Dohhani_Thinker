-- 필사 (Pilsa) — initial schema
-- One row per entry (the entry body / highlights / interpretation / corrections / Claude threads
-- live inside `data` jsonb, mirroring the client model). One `app_state` row per user holds the
-- cross-entry stuff: the personal dictionary (terms) and settings (art mode, published ids, …).

create extension if not exists "pgcrypto";

-- ── entries ────────────────────────────────────────────────────────────────
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date  date not null default current_date,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists entries_user_date_idx
  on public.entries (user_id, entry_date desc, created_at desc);

-- ── app_state (one per user) ───────────────────────────────────────────────
create table if not exists public.app_state (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  terms       jsonb not null default '[]'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ── keep updated_at honest ─────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before update on public.entries
  for each row execute function public.touch_updated_at();

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch before update on public.app_state
  for each row execute function public.touch_updated_at();

-- ── row-level security: a user sees only their own rows ────────────────────
alter table public.entries  enable row level security;
alter table public.app_state enable row level security;

drop policy if exists "entries: own rows" on public.entries;
create policy "entries: own rows" on public.entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "app_state: own row" on public.app_state;
create policy "app_state: own row" on public.app_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
