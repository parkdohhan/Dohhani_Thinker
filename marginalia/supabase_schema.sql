-- MARGINALIA — run once in Supabase SQL Editor
-- Extensions
create extension if not exists "pgcrypto";

-- ── Tables ──
create table public.contexts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  raw_content text default '' not null,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  context_id uuid not null references public.contexts (id) on delete cascade,
  parent_id uuid references public.sessions (id) on delete cascade,
  is_reply boolean not null default false,
  mode text not null check (mode in ('correct', 'expand', 'deep')),
  original text not null,
  corrected text,
  expressions text[],
  summary text,
  questions text[],
  created_at timestamptz not null default now(),
  search_vector tsvector,
  constraint sessions_one_level_reply check (
    parent_id is null
    or exists (
      select 1 from public.sessions p
      where p.id = sessions.parent_id and p.parent_id is null
    )
  )
);

create index sessions_context_id_idx on public.sessions (context_id);
create index sessions_parent_id_idx on public.sessions (parent_id);
create index sessions_search_idx on public.sessions using gin (search_vector);

create table public.session_errors (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  tag text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index session_errors_session_id_idx on public.session_errors (session_id);

-- ── search_vector trigger ──
create or replace function public.sessions_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.original, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.corrected, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.summary, '')), 'C');
  return new;
end;
$$;

drop trigger if exists sessions_search_vector_trigger on public.sessions;
create trigger sessions_search_vector_trigger
  before insert or update of original, corrected, summary on public.sessions
  for each row
  execute procedure public.sessions_search_vector_update();

-- ── RPC: full-text search ──
create or replace function public.search_sessions(query text)
returns table (
  session_id uuid,
  context_id uuid,
  context_title text,
  original text,
  corrected text,
  summary text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    s.id,
    s.context_id,
    c.title,
    s.original,
    s.corrected,
    s.summary,
    s.created_at
  from public.sessions s
  join public.contexts c on c.id = s.context_id
  where
    length(trim(query)) > 0
    and s.search_vector @@ websearch_to_tsquery('english', trim(query))
  order by s.created_at desc
  limit 100;
$$;

-- ── RPC: error frequency ──
create or replace function public.error_summary()
returns table (
  tag text,
  cnt bigint
)
language sql
stable
as $$
  select se.tag, count(*)::bigint as cnt
  from public.session_errors se
  group by se.tag
  order by cnt desc;
$$;

-- ── RPC: weekly trend ──
create or replace function public.error_trend_weekly()
returns table (
  week_start date,
  tag text,
  cnt bigint
)
language sql
stable
as $$
  select
    (date_trunc('week', se.created_at at time zone 'utc'))::date as week_start,
    se.tag,
    count(*)::bigint as cnt
  from public.session_errors se
  group by 1, se.tag
  order by week_start desc, cnt desc;
$$;

-- ── RLS (single user, open policies) ──
alter table public.contexts enable row level security;
alter table public.sessions enable row level security;
alter table public.session_errors enable row level security;

create policy "contexts_allow_all" on public.contexts for all using (true) with check (true);
create policy "sessions_allow_all" on public.sessions for all using (true) with check (true);
create policy "session_errors_allow_all" on public.session_errors for all using (true) with check (true);

-- ── Grants ──
grant usage on schema public to anon, authenticated;
grant all on public.contexts to anon, authenticated;
grant all on public.sessions to anon, authenticated;
grant all on public.session_errors to anon, authenticated;
grant execute on function public.search_sessions(text) to anon, authenticated;
grant execute on function public.error_summary() to anon, authenticated;
grant execute on function public.error_trend_weekly() to anon, authenticated;
