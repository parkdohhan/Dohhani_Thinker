# 필사 (Pilsa)

A web-based bilingual reading journal — transcribe an English passage by hand, mark unknown
words (🟡) and unclear phrases (🔵) by colour, write a Korean interpretation, and ask Claude.
Over months the words you met reappear with visible traces, and the same archive can be viewed
through a second mode — a public, Cha-style art piece. Both a personal study tool and a document
of one reader crossing between two languages.

Front-end is a static site (vanilla HTML/CSS/JS — no build step). Data, auth and the Claude
proxy live on **Supabase** (project `Dohhani_Thinker`, ref `ooqzmtgbhctsrghjnrda`).

## What's in it

- **Daily mode** — sidebar (`+ 새 문서 · 검색 · 나의 단어 · 나의 문장 · 나의 패턴 · 질문 노트 · 프로젝트 | 서가 · 오늘 재시도 · 최근`) + entry view (date · author/title/page · English body · Korean interpretation) + the 바로 묻기 tutor on the right.
- **Highlighting** — click the body to edit, drag-select, then 🟡 단어 / 🔵 구절 / △ 묻기. Yellow words feed the personal dictionary; offsets re-anchor as you edit.
- **나의 단어 (dictionary)** — every yellow-marked word, its definitions (you add them), every encounter in order with the surrounding sentence + source, and what Claude said about it. When a word reappears in another entry it gets a dotted underline + a hover tooltip ("처음 만난 곳…").
- **Claude** — three ways in: (a) write your Korean rendering / questions in the **interpretation field** and press **△ Claude에게 보내기** (`⌘↵`) — Claude answers in the panel *and* files the words/phrases you were unsure about into 나의 단어 / 나의 문장 automatically (a 🟡 mark + △ anchors appear in the body); (b) select a sentence → "△ 묻기" creates a △ anchor + a thread; (c) ask a general question in the panel at the bottom. Concise, Korean-by-default literary tutoring (word meaning · grammar · style · checking your translation). Calls go through a Supabase Edge Function — the API key never reaches the browser.
- **나의 문장** — every anchored Claude thread, as a browsable archive: click a sentence to see your interpretation + Claude's feedback (meaning / grammar / a better rendering). Exactly the "my words / my sentences" split.
- **Search** — `⌘K`. Full-text over body · interpretation · source · Claude messages, with filter chips (highlight colour, has-Claude, date range, author).
- **프로젝트** — entries group by author/title; opening one renders each kind in its own genre. 필사 → **아카이브 (Art mode)**: Cha-style (black/white, sparse, thin serif, Latin-footnote source citations), chronological numbered fragments, corrections as struck-through palimpsests (errors preserved), per-entry publish/hide toggle, a curator's note. 역번역 → **오답노트**: category totals as a per-source weakness map, every divergence deduped à la 나의 패턴 (same 갈림 = a repeat count, "나의 패턴에 담김" marked), and a per-문단 digest (stage · next revisit · Claude's verdict + better renderings). Mixed projects get an `아카이브 | 오답노트` toggle; reverse-only projects open straight into the notebook.
- **발표 연습 (speech practice)** — started from a project's 오답노트. Jot 5–7 keywords, speak with no script — the app shows only a timer while the browser's Web Speech API transcribes locally (audio is never stored). Then hand-correct the transcript and submit: Claude reviews it against the project's source paragraphs — what the run **missed** (요점, in Korean), plus spoken wordings → better spoken alternatives in the same four categories, each filable into 나의 패턴, so writing and speaking share one weakness map. Records live only in the project's notebook (hidden from the daily flow and search).
- **역번역 (reverse translation)** — a drill, not a piece of writing. Pair a Korean paragraph of your own with its English translation (the *target*), then reproduce the English from the Korean with the target hidden. Paste a whole long paragraph and setup **auto-splits it into 문단s of 2-3 sentences each** (toggle in the setup panel): aligned locally when the Korean and English sentence counts match, via a Claude `segment` call when the translation merges/splits sentences — and only accepted if the chunks reassemble both originals verbatim; otherwise it saves unsplit. On submit, the **headline metric is the card verdict** (error count + per-category chips); the two-column word-diff stays as a visual aid only, since it counts structural choice differences as noise. Claude judges every divergence on **three axes — 의미 보존 · 문법 정확 · register 적합** — and a divergence that passes all three is filed under **수용 가능한 변형** (an acceptable variant, not an error; the target is one rendering, not an answer key). Real errors get the four categories (`lexis-register` / `connectives` / `structure` / `articles-prepositions`), the whole sentence marked red/green, a **옳은 문장** row between them (my own sentence, minimally repaired for grammar and meaning — my structure kept, the changed words in blue), and a 필사 box underneath. 필사 is **verified**: normalized for case/punctuation, then compared strictly — a wrong copy shows ✗ and blocks progress. The next revisit is scheduled **only when every 필사 matches** (submitting alone no longer advances the cycle), and it follows the **forgetting curve**, not a fixed ladder: each 문단 carries a memory *stability* in days, and the attempt is graded by the weight of its errors (meaning 1.0 · grammar 0.6 · register 0.3, per ~20 words of target). A good recall multiplies the gap by the item's ease (starting 2.5), a barely-there one by 1.2, a forgotten one drops it back to tomorrow; a late but successful recall counts from the days actually elapsed. There is no "done" — past 60 days an item is 「굳음」 and keeps coming back, months apart. A broken analysis grades nothing. Attempts are append-only; the target is never in the DOM while you're writing.
- **나의 패턴** — the divergences you chose to keep, deduped by `내 표현 → 목표 표현` so a repeated failure raises a counter instead of adding a row. Four category chips double as a weakness map. Filing is not the end of the loop: each pattern stores the Korean fragment it came from, and filing schedules a **retrieval review** on the same forgetting curve (the first one tomorrow) — the pattern view shows the Korean only, you re-produce the English from memory, and 정답 대조 lays out **이번** (what you just wrote) · **옳은** (that sentence repaired on the spot by a small `patfix` call — your structure kept, never pulled toward the reference; the pattern's stored correction belongs to the original paragraph and is not shown here) · **목표** (the original rendering). Then self-grade with three buttons (잊었다 · 겨우 떠올렸다 · 바로 떠올렸다), each labelled with the date it would schedule — and the two "I didn't have it" grades open a 필사 box first: the schedule moves only once you have copied the target sentence correctly. Forgetting bumps the repeat counter and restarts the curve; filing the same 갈림 again counts as forgetting. Due reviews surface in the sidebar's 오늘 재시도 block. **선택** (next to the filters) puts a check on every review card and row — pick any number and delete them in one go; only what is on screen can be picked, so a filter never hides part of a deletion, and review cards keep their answers covered while you pick.
- **바로 묻기 · 질문 노트** — a tutor docked on the right of every page (`⌘/`). On wide screens it sits beside the content, which moves over to make room, and stays put while you scroll; on narrow screens it folds into a bottom-right button that opens a floating panel. It sees what you are looking at (the 필사 passage and your interpretation, or a 역번역's Korean source and your draft — **never the hidden target while you are still writing**, and it is told not to translate the drill for you) and anything you drag-selected before asking. Every answer is filed in **질문 노트** as a mistakes-notebook card that Claude writes alongside the answer: title · category (문법/어휘/쓰임/표현/기타) · 핵심 one-liner · ✗ wrong form / ✓ right form · examples, plus your question, the full answer and a link back to the page you asked from. Cards group by day, filter by category/text/★, and "이어서 묻기" reopens one as the context for a follow-up.
- **코퍼스 (문학/학술)** — every document carries a corpus toggle (필사·역번역 headers; kits declare theirs). It steers the register axis of 역번역 feedback: academic documents are judged against academic discourse norms (This suggests that…, We propose…) and literary idiom in the target is *not* enforced; literary documents keep the literary standard. The projects grid filters by corpus, and cards show a 문학/학술 chip.
- **Errors preserved** — editing a saved interpretation pushes the prior version into the entry's `corrections`; visible in Art mode and via "n번 고쳐 씀 — 이전 해석 보기".
- **Keyboard** — `⌘N` new · `⌘K` search · `⌘/` 바로 묻기 · `⌘S` force-sync · `⌘1`/`⌘3` pick 필사/역번역 in the new-doc modal · `⌘1`/`⌘2` yellow/blue on a selection (in edit mode) · `⌘↵` sends the interpretation / 역번역 attempt · `Esc` closes things.
- Cross-device sync (local-first cache → Supabase), light + dark, JSON export/import, responsive sidebar collapse.

## One-time Supabase setup (do this once, then it just works)

The database schema and the `claude` Edge Function are **already deployed** to project
`Dohhani_Thinker`. Two settings still need a click in the Supabase dashboard:

1. **Anthropic API key** (so Claude works) — Dashboard → Project Settings → Edge Functions → *Manage secrets* → add
   `ANTHROPIC_API_KEY = sk-ant-...`
   (or with the CLI: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref ooqzmtgbhctsrghjnrda`).
   Until this is set, the Claude panel shows a clear "ANTHROPIC_API_KEY is not configured" message; everything else works.

2. **Email login** — Dashboard → Authentication → Providers → Email → turn **"Confirm email" OFF**
   (this is a single-user personal app; no need for the email-confirmation round-trip).
   If you'd rather keep confirmation on, instead set Authentication → URL Configuration → *Site URL* and *Redirect URLs* to the URL where you run the app (e.g. `http://localhost:5510`) so the confirmation link works.

Then open the app, pick **회원가입**, enter an email + password — that's your account. Use the same
credentials on any other device.

> If you ever rotate the Supabase keys, update `SUPABASE_URL` / `SUPABASE_KEY` at the top of `app.js`.
> (The publishable key in there is meant to be public — it's safe in client code; RLS protects the data.)

## Run it

Static site — serve the folder over http (ES/`fetch` and Supabase auth need http, not `file://`):

```sh
python3 -m http.server 5510   # then http://localhost:5510
```

(`.vscode/settings.json` also wires the Live Server extension to port 5501.)

## Deploy

Any static host. On Vercel/Netlify/GitHub Pages just push the repo — `index.html` is served at `/`.
After deploying, add the deployed URL to Supabase → Authentication → URL Configuration (Site URL +
Redirect URLs) if you kept email confirmation on; otherwise nothing else to do.

## Files

| | |
|---|---|
| `index.html` · `styles.css` · `app.js` | the whole front-end |
| `supabase/migrations/0001_init.sql` | `entries` + `app_state` tables, RLS, `updated_at` trigger (already applied) |
| `supabase/migrations/0002_reverse_patterns.sql` | `app_state.patterns` column for 나의 패턴 (already applied) |
| `supabase/migrations/0003_questions.sql` | `app_state.questions` column for 질문 노트 (already applied) |
| `supabase/functions/claude/index.ts` | the Anthropic proxy Edge Function — redeploy after changing it: `supabase functions deploy claude --project-ref ooqzmtgbhctsrghjnrda` |

### Data model (in `entries.data` jsonb, one row per entry)

```
Entry  { id, date, kind:'transcription'|'reverse'|'speech',   // legacy 'reflection' rows still exist — see below
         source:{author,title,page}, createdAt, updatedAt }

// kind: 'transcription' — one document, many passages
     + passages:[{ id, body, interpretation,
                   highlights:[{id,startChar,endChar,type:'yellow'|'blue',note}],
                   corrections:[{timestamp,previousText,newText}],
                   threads:[{id,anchorChar,anchorText,fromInterp,createdAt,messages:[…]}] }]
     + body / highlights / interpretation / corrections / threads   // mirror of the active passage

// kind: 'speech' — 발표 연습 (recorded from a project's 오답노트; audio discarded)
     + speech:{ keywords:[…], durationSec, transcript, rawTranscript,
                analysis: null | { verdict, missed:[…],
                                   diffs:[{mine,targetFrag,category,note}] } }

// kind: 'reflection' — the removed 사유 mode (legacy). Old rows keep their
//   reflection:{mode,blocks} data, still sync, and still appear in JSON backups —
//   but the UI never shows them (`isShown` filters them out everywhere).

// kind: 'reverse' — the 역번역 drill
     + reverse:{ koSource, target,                       // target: never rendered while writing
                 attempts:[{ id, timestamp, text,        // append-only
                             analysis: null | { verdict,
                               diffs:[{mine,targetFrag,ko,fixed,category,note,practice}],  // fixed = 옳은 문장: my sentence, minimally repaired
                               better:[…] } }],
                 srs:{ stability, ease, reps, lapses, last },   // forgetting-curve state; stability 0 = never reviewed
                 nextRevisit: null|'YYYY-MM-DD' }                // = last + stability
// legacy `stage:'new'|'d3'|'d14'|'done'` is read once and migrated into `srs` (deterministically — see normSrs)
```
`app_state.terms` = `[{id,word,definitions:[…],encounters:[{entryId,date,context,note,charStart,charEnd}]}]`,
`app_state.patterns` = `[{id,mine,targetFrag,ko,fixed,category,note,starred,sourceEntryId,createdAt,hits,srs,nextReview}]`,
`app_state.questions` = `[{id,createdAt,q,a,title,category,point,wrong,right,examples:[…],context:{entryId,label,selection},starred}]`,
`app_state.settings` = `{artAesthetic:'cha', curatorNote, unpublishedIds:[…]}`.

> Adding a field to an entry means touching **four** places — `blankEntry`, `normEntry`
> (and its per-kind `norm*` helper), `entryToRow`, and `rowToEntry`. A field `normEntry`
> doesn't know is silently dropped on the next Supabase round trip.

## Known limits / TODO

- Highlighting and "△ 묻기" happen in the body's **edit mode** (click the text to enter it). Read-mode hover gives tooltips + clickable △ anchors.
- Editing *inside* an existing highlight clears that highlight (re-mark it); highlights before/after an edit shift correctly.
- Sync is per-entry last-write-wins by `updatedAt` — fine for one user; not a CRDT.
- 발표 연습 transcription uses the browser's Web Speech API — Chrome-family only. On other browsers the modal falls back to typing the transcript yourself. Audio is never saved.
- Static export of the art view as a standalone HTML file isn't built yet (use JSON export for backup; the art view itself is the deliverable in-app).
- The old `marginalia`-era tables in this Supabase project (`sessions`, `contexts`, …) are untouched and still have permissive policies — drop them in the dashboard if you don't need them.
