-- 필사 (Pilsa) — 질문 노트
--
-- 「바로 묻기」(the tutor docked beside every page) files each question and its
-- answer as a mistakes-notebook card: { q, a, title, category, point, wrong,
-- right, examples[], context{entryId,label,page,selection}, starred, createdAt }.
-- Like 「나의 패턴」 it is cross-entry, so it lives beside `terms` on app_state.

alter table public.app_state
  add column if not exists questions jsonb not null default '[]'::jsonb;
