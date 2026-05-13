# 필사 (Pilsa)

A web-based bilingual reading journal — transcribe an English passage by hand, mark unknown
words (🟡) and unclear phrases (🔵) by colour, write a Korean interpretation, and ask Claude.
Over months the words you met reappear with visible traces, and the same archive can be viewed
through a second mode — a public, Cha-style art piece. Both a personal study tool and a document
of one reader crossing between two languages.

Front-end is a static site (vanilla HTML/CSS/JS — no build step). Data, auth and the Claude
proxy live on **Supabase** (project `Dohhani_Thinker`, ref `ooqzmtgbhctsrghjnrda`).

## What's in it

- **Daily mode** — sidebar (`+ 새 필사 · 검색 · 나의 단어 · 나의 문장 · 프로젝트·아카이브 · 최근`) + entry view (date · author/title/page · English body · Korean interpretation).
- **Highlighting** — click the body to edit, drag-select, then 🟡 단어 / 🔵 구절 / △ 묻기. Yellow words feed the personal dictionary; offsets re-anchor as you edit.
- **나의 단어 (dictionary)** — every yellow-marked word, its definitions (you add them), every encounter in order with the surrounding sentence + source, and what Claude said about it. When a word reappears in another entry it gets a dotted underline + a hover tooltip ("처음 만난 곳…").
- **Claude** — three ways in: (a) write your Korean rendering / questions in the **interpretation field** and press **△ Claude에게 보내기** (`⌘↵`) — Claude answers in the panel *and* files the words/phrases you were unsure about into 나의 단어 / 나의 문장 automatically (a 🟡 mark + △ anchors appear in the body); (b) select a sentence → "△ 묻기" creates a △ anchor + a thread; (c) ask a general question in the panel at the bottom. Concise, Korean-by-default literary tutoring (word meaning · grammar · style · checking your translation). Calls go through a Supabase Edge Function — the API key never reaches the browser.
- **나의 문장** — every anchored Claude thread, as a browsable archive: click a sentence to see your interpretation + Claude's feedback (meaning / grammar / a better rendering). Exactly the "my words / my sentences" split.
- **Search** — `⌘K`. Full-text over body · interpretation · source · Claude messages, with filter chips (highlight colour, has-Claude, date range, author).
- **프로젝트 · 아카이브 (Art mode)** — Cha-style (black/white, sparse, thin serif, Latin-footnote source citations). Chronological fragments, numbered; corrections shown as struck-through palimpsests (errors preserved); per-entry publish/hide toggle; a curator's note.
- **Errors preserved** — editing a saved interpretation pushes the prior version into the entry's `corrections`; visible in Art mode and via "n번 고쳐 씀 — 이전 해석 보기".
- **Keyboard** — `⌘N` new · `⌘K` search · `⌘S` force-sync · `⌘1`/`⌘2` yellow/blue on a selection (in edit mode) · `⌘↵` in the interpretation field sends it to Claude · `Esc` closes things.
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
| `supabase/functions/claude/index.ts` | the Anthropic proxy Edge Function — redeploy after changing it: `supabase functions deploy claude --project-ref ooqzmtgbhctsrghjnrda` |

### Data model (in `entries.data` jsonb, one row per entry)

```
Entry  { id, date, source:{author,title,page}, body, interpretation,
         highlights:[{id,startChar,endChar,type:'yellow'|'blue',note}],
         corrections:[{timestamp,previousText,newText}],
         threads:[{id,anchorChar,anchorText,fromInterp,createdAt,messages:[{id,role,content,timestamp}]}] }
```
`app_state.terms` = `[{id,word,definitions:[…],encounters:[{entryId,date,context,note,charStart,charEnd}]}]`,
`app_state.settings` = `{artAesthetic:'cha', curatorNote, unpublishedIds:[…]}`.

## Known limits / TODO

- Highlighting and "△ 묻기" happen in the body's **edit mode** (click the text to enter it). Read-mode hover gives tooltips + clickable △ anchors.
- Editing *inside* an existing highlight clears that highlight (re-mark it); highlights before/after an edit shift correctly.
- Sync is per-entry last-write-wins by `updatedAt` — fine for one user; not a CRDT.
- Static export of the art view as a standalone HTML file isn't built yet (use JSON export for backup; the art view itself is the deliverable in-app).
- The old `marginalia`-era tables in this Supabase project (`sessions`, `contexts`, …) are untouched and still have permissive policies — drop them in the dashboard if you don't need them.
