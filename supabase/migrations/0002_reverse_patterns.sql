-- 필사 (Pilsa) — 역번역 (reverse translation) support
--
-- The reverse entries themselves need no schema change: they ride inside
-- `entries.data` jsonb like every other entry kind (`data.kind = 'reverse'`,
-- `data.reverse = { koSource, target, attempts[], nextRevisit, stage }`).
--
-- What is new is the cross-entry pattern note (「나의 패턴」) — the diffs the
-- reader chose to keep from an analysis. It lives beside `terms` on app_state.

alter table public.app_state
  add column if not exists patterns jsonb not null default '[]'::jsonb;
