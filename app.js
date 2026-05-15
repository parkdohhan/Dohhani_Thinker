/* ============================================================
   필사 (Pilsa) — bilingual reading journal
   Vanilla front-end · Supabase (auth + storage) · Claude via Edge Function
   ============================================================ */
(() => {
  "use strict";

  /* ─────────────────────── CONFIG ─────────────────────── */
  const SUPABASE_URL = "https://ooqzmtgbhctsrghjnrda.supabase.co";
  const SUPABASE_KEY = "sb_publishable_XBDVF5MAkAhhK2qx3s0pvw_3ntkx17R";
  const CLAUDE_FN = `${SUPABASE_URL}/functions/v1/claude`;
  const SAVE_DEBOUNCE = 700;

  if (!window.supabase || !window.supabase.createClient) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = '<div style="max-width:420px;margin:18vh auto;font-family:sans-serif;color:#5b574e;text-align:center;line-height:1.7;">Supabase 라이브러리를 불러오지 못했습니다.<br/>네트워크 연결을 확인하고 새로고침해 주세요.</div>';
    });
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  /* ─────────────────────── HELPERS ─────────────────────── */
  const $ = (id) => document.getElementById(id);
  const uid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  const nowISO = () => new Date().toISOString();
  const todayISO = () => {
    const d = new Date(), z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const weekdayOf = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { weekday: "long" });
  };
  const fmtDate = (iso) => (iso && iso.length >= 10 ? iso.slice(0, 10).replace(/-/g, ".") : iso || "");
  const fmtMD = (iso) => (iso && iso.length >= 10 ? iso.slice(5, 10).replace("-", ".") : iso || "");
  const daysAgo = (iso) => {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return null;
    return Math.round((Date.parse(todayISO() + "T00:00:00") - d.getTime()) / 86400000);
  };
  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }
  function autoGrow(el, max) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, max || 1e6) + "px";
  }
  function toRoman(n) {
    if (n < 1 || n > 3999) return String(n);
    const t = [["M",1000],["CM",900],["D",500],["CD",400],["C",100],["XC",90],["L",50],["XL",40],["X",10],["IX",9],["V",5],["IV",4],["I",1]];
    let r = "";
    for (const [s, v] of t) while (n >= v) { r += s; n -= v; }
    return r;
  }
  function pageRef(p) {
    p = String(p || "").trim();
    if (!p) return "";
    return /^(p\.?|pp\.?|쪽|페이지|면|\d+\s*쪽)/i.test(p) ? p : "p. " + p;
  }
  // a tiny, safe-ish markdown for Claude replies
  function mdInline(text) {
    let h = esc(text);
    h = h.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    h = h.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<b>${c}</b>`);
    h = h.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, (_, a, c) => `${a}<i>${c}</i>`);
    return h;
  }
  // word normalization for the personal dictionary — first word-ish token, lowercased
  function normWord(w) {
    const s = String(w == null ? "" : w).toLowerCase().replace(/[‘’]/g, "'");
    const m = s.match(/[a-z][a-z'-]*[a-z]|[a-z]/);
    return m ? m[0].replace(/^['-]+|['-]+$/g, "") : "";
  }
  function sentenceAround(text, a, b) {
    // the chunk of `text` (a clause/sentence) that contains [a,b)
    const breaks = [];
    const re = /[.!?…]+["'”’)\]]?\s+|\n+/g;
    let m;
    while ((m = re.exec(text))) breaks.push(m.index + m[0].length);
    let start = 0, end = text.length;
    for (const bp of breaks) { if (bp <= a) start = bp; else { end = bp; break; } }
    return { text: text.slice(start, end).trim(), start, end };
  }
  // locate an English word inside `body` (word-boundary, case-insensitive); falls back to a prefix match
  function findWordSpan(body, word) {
    const core = String(word == null ? "" : word).match(/[A-Za-z][A-Za-z'’-]*/);
    if (!body || !core) return null;
    const rx = core[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let m = new RegExp("\\b" + rx + "\\b", "i").exec(body);
    if (!m) m = new RegExp("\\b" + rx + "[A-Za-z'’-]*", "i").exec(body);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  }
  function sentenceContaining(body, needle) {
    if (!body || !needle) return "";
    const i = String(body).toLowerCase().indexOf(String(needle).toLowerCase());
    if (i < 0) return "";
    return sentenceAround(String(body), i, i + String(needle).length).text;
  }

  /* ─────────────────────── STATE ─────────────────────── */
  let user = null; // { id, email }
  let state = newVault();
  let currentId = null; // open entry id
  let activeThreadId = null; // thread receiving compose messages
  let editing = false; // body edit mode
  let online = navigator.onLine;
  const dirtyEntries = new Set();
  const deletedEntries = new Set();
  let dirtyAppState = false;

  function newVault() { return { entries: [], terms: [], settings: { artAesthetic: "cha", curatorNote: "", unpublishedIds: [] } }; }

  function blankEntry(kind) {
    kind = kind === "reflection" ? "reflection" : "transcription";
    const t = nowISO();
    const base = {
      id: uid(), date: todayISO(),
      kind,
      source: { author: "", title: "", page: "" },
      createdAt: t, updatedAt: t,
    };
    if (kind === "reflection") {
      base.reflection = { mode: "correct", body: "", revisions: [] };
    } else {
      base.body = ""; base.highlights = []; base.interpretation = "";
      base.corrections = []; base.threads = [];
    }
    return base;
  }
  function normRevision(r) {
    r = r && typeof r === "object" ? r : {};
    const m = r.mode === "expand" || r.mode === "deep" ? r.mode : "correct";
    return {
      timestamp: r.timestamp || nowISO(),
      mode: m,
      input: typeof r.input === "string" ? r.input : "",
      corrected: typeof r.corrected === "string" ? r.corrected : "",
      errors: Array.isArray(r.errors) ? r.errors
        .filter((x) => x && typeof x === "object")
        .map((x) => ({ tag: typeof x.tag === "string" ? x.tag : "grammar/other", detail: typeof x.detail === "string" ? x.detail : "" })) : [],
      expressions: Array.isArray(r.expressions) ? r.expressions.filter((x) => typeof x === "string") : [],
      summary: typeof r.summary === "string" ? r.summary : "",
      questions: Array.isArray(r.questions) ? r.questions.filter((x) => typeof x === "string") : [],
    };
  }
  function normEntry(e) {
    e = e && typeof e === "object" ? e : {};
    const s = e.source && typeof e.source === "object" ? e.source : {};
    const kind = e.kind === "reflection" ? "reflection" : "transcription";
    const out = {
      id: typeof e.id === "string" ? e.id : uid(),
      date: typeof e.date === "string" && e.date ? e.date.slice(0, 10) : todayISO(),
      kind,
      source: { author: s.author || "", title: s.title || "", page: s.page || "" },
      createdAt: e.createdAt || nowISO(),
      updatedAt: e.updatedAt || e.createdAt || nowISO(),
    };
    if (kind === "reflection") {
      const r = e.reflection && typeof e.reflection === "object" ? e.reflection : {};
      out.reflection = {
        mode: r.mode === "expand" || r.mode === "deep" ? r.mode : "correct",
        body: typeof r.body === "string" ? r.body : "",
        revisions: Array.isArray(r.revisions) ? r.revisions.map(normRevision) : [],
      };
    } else {
      out.body = typeof e.body === "string" ? e.body : "";
      out.highlights = Array.isArray(e.highlights) ? e.highlights.filter((h) => h && h.endChar > h.startChar).map((h) => ({
        id: h.id || uid(), startChar: h.startChar | 0, endChar: h.endChar | 0,
        type: h.type === "blue" ? "blue" : "yellow", note: h.note || "",
      })) : [];
      out.interpretation = typeof e.interpretation === "string" ? e.interpretation : "";
      out.corrections = Array.isArray(e.corrections) ? e.corrections.filter((c) => c && typeof c === "object").map((c) => ({
        timestamp: c.timestamp || nowISO(), previousText: c.previousText || "", newText: c.newText || "",
      })) : [];
      out.threads = Array.isArray(e.threads) ? e.threads.map(normThread) : (Array.isArray(e.messages) ? migrateMessages(e.messages) : []);
    }
    return out;
  }
  function normThread(t) {
    t = t && typeof t === "object" ? t : {};
    return {
      id: t.id || uid(),
      anchorChar: Number.isFinite(t.anchorChar) ? t.anchorChar | 0 : null,
      anchorText: t.anchorText || "",
      fromInterp: !!t.fromInterp,
      createdAt: t.createdAt || nowISO(), updatedAt: t.updatedAt || nowISO(),
      messages: Array.isArray(t.messages) ? t.messages
        .filter((m) => m && m.content != null && (m.role !== "assistant" || String(m.content).trim() !== ""))
        .map((m) => ({ id: m.id || uid(), role: m.role === "assistant" ? "assistant" : "user", content: String(m.content), timestamp: m.timestamp || nowISO() })) : [],
    };
  }
  function migrateMessages(arr) { // legacy flat messages → one thread
    const msgs = arr.filter((m) => m && m.content != null);
    if (!msgs.length) return [];
    return [normThread({ messages: msgs })];
  }
  function normVault(v) {
    v = v && typeof v === "object" ? v : {};
    return {
      entries: Array.isArray(v.entries) ? v.entries.map(normEntry) : [],
      terms: Array.isArray(v.terms) ? v.terms.filter((x) => x && x.word).map((t) => ({
        id: t.id || uid(), word: normWord(t.word) || String(t.word).toLowerCase(),
        definitions: Array.isArray(t.definitions) ? t.definitions.filter((d) => typeof d === "string") : [],
        encounters: Array.isArray(t.encounters) ? t.encounters.filter((x) => x && x.entryId).map((x) => ({
          entryId: x.entryId, date: x.date || todayISO(), context: x.context || "", note: x.note || "",
          charStart: x.charStart | 0, charEnd: x.charEnd | 0,
        })) : [],
      })) : [],
      settings: {
        artAesthetic: (v.settings && v.settings.artAesthetic) || "cha",
        curatorNote: (v.settings && v.settings.curatorNote) || "",
        unpublishedIds: (v.settings && Array.isArray(v.settings.unpublishedIds)) ? v.settings.unpublishedIds : [],
      },
    };
  }

  const findEntry = (id) => state.entries.find((e) => e.id === id) || null;
  const currentEntry = () => findEntry(currentId);
  function orderedEntries() {
    return [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function entriesChrono() {
    return [...state.entries].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  function touchEntry(e) { if (!e) return; e.updatedAt = nowISO(); dirtyEntries.add(e.id); scheduleSync(); cacheLocal(); }
  function touchAppState() { dirtyAppState = true; scheduleSync(); cacheLocal(); }

  /* ─────────────────────── TERMS ─────────────────────── */
  let termWords = new Set();
  const wordRe = /[A-Za-z][A-Za-z'’-]*/g;
  function rebuildTermIndex() { termWords = new Set(state.terms.map((t) => t.word).filter(Boolean)); }
  function findTerm(w) { w = normWord(w); return state.terms.find((t) => t.word === w) || null; }
  function upsertEncounter(entry, hl) {
    const raw = entry.body.slice(hl.startChar, hl.endChar);
    const w = normWord(raw);
    if (!w || w.length < 2) return;
    let term = findTerm(w);
    if (!term) { term = { id: uid(), word: w, definitions: [], encounters: [] }; state.terms.push(term); }
    const ctx = sentenceAround(entry.body, hl.startChar, hl.endChar).text;
    const existing = term.encounters.find((x) => x.entryId === entry.id && Math.abs(x.charStart - hl.startChar) < 2);
    if (existing) { existing.context = ctx; existing.note = hl.note || existing.note; existing.date = entry.date; existing.charStart = hl.startChar; existing.charEnd = hl.endChar; }
    else term.encounters.push({ entryId: entry.id, date: entry.date, context: ctx, note: hl.note || "", charStart: hl.startChar, charEnd: hl.endChar });
    rebuildTermIndex();
    touchAppState();
  }
  function pruneEntryFromTerms(entryId) {
    for (const t of state.terms) t.encounters = t.encounters.filter((x) => x.entryId !== entryId);
    state.terms = state.terms.filter((t) => t.encounters.length || t.definitions.length);
    rebuildTermIndex();
    touchAppState();
  }
  function termEncountersSorted(t) { return [...t.encounters].sort((a, b) => a.date.localeCompare(b.date)); }
  function termClaudeNotes(word) {
    const out = [];
    for (const e of state.entries) {
      if (e.kind === "reflection") continue;
      for (const th of e.threads) {
        if (normWord(th.anchorText) === word) for (const m of th.messages) if (m.role === "assistant") out.push({ entry: e, thread: th, msg: m });
      }
    }
    return out;
  }

  /* ─────────────────────── LOCAL CACHE ─────────────────────── */
  const cacheKey = () => (user ? `pilsa:cache:${user.id}` : null);
  const lastOpenKey = () => (user ? `pilsa:lastopen:${user.id}` : null);
  function cacheLocal() {
    const k = cacheKey(); if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(state)); } catch (_) {}
  }
  function loadCache() {
    const k = cacheKey(); if (!k) return false;
    try { const raw = localStorage.getItem(k); if (raw) { state = normVault(JSON.parse(raw)); rebuildTermIndex(); return true; } } catch (_) {}
    return false;
  }

  /* ─────────────────────── SUPABASE I/O ─────────────────────── */
  function entryToRow(e) {
    const data = { kind: e.kind || "transcription", source: e.source };
    if (e.kind === "reflection") {
      data.reflection = e.reflection || { mode: "correct", body: "", revisions: [] };
    } else {
      data.body = e.body; data.highlights = e.highlights;
      data.interpretation = e.interpretation; data.corrections = e.corrections; data.threads = e.threads;
    }
    return { id: e.id, user_id: user.id, entry_date: e.date, updated_at: e.updatedAt, created_at: e.createdAt, data };
  }
  function rowToEntry(r) {
    const d = r.data || {};
    return normEntry({ id: r.id, date: r.entry_date, kind: d.kind, source: d.source,
      body: d.body, highlights: d.highlights, interpretation: d.interpretation, corrections: d.corrections,
      threads: d.threads, messages: d.messages, reflection: d.reflection,
      createdAt: r.created_at, updatedAt: r.updated_at });
  }
  async function pullAll() {
    if (!user) return;
    setSync("syncing");
    try {
      const [er, ar] = await Promise.all([
        sb.from("entries").select("*").order("entry_date", { ascending: false }),
        sb.from("app_state").select("*").maybeSingle(),
      ]);
      if (er.error) throw er.error;
      const remote = (er.data || []).map(rowToEntry);
      // merge: per-id last-write-wins by updatedAt; push local-only & locally-newer
      const byId = new Map(state.entries.map((e) => [e.id, e]));
      const seen = new Set();
      for (const r of remote) {
        seen.add(r.id);
        const loc = byId.get(r.id);
        if (!loc) byId.set(r.id, r);
        else if (String(loc.updatedAt) > String(r.updatedAt)) dirtyEntries.add(loc.id); // local is newer → re-push
        else byId.set(r.id, r);
      }
      for (const e of state.entries) if (!seen.has(e.id) && !deletedEntries.has(e.id)) dirtyEntries.add(e.id); // local-only → push
      state.entries = [...byId.values()].filter((e) => !deletedEntries.has(e.id));
      // app_state
      if (!ar.error && ar.data) {
        const rTerms = Array.isArray(ar.data.terms) ? ar.data.terms : [];
        const rSettings = ar.data.settings || {};
        const remoteNewer = !state.__appUpdatedAt || String(ar.data.updated_at) >= String(state.__appUpdatedAt);
        if (remoteNewer) { state.terms = normVault({ terms: rTerms }).terms; state.settings = normVault({ settings: rSettings }).settings; }
        else dirtyAppState = true;
      } else if (!ar.data) {
        dirtyAppState = true; // no remote row yet — create it
      }
      state.__appUpdatedAt = ar.data ? ar.data.updated_at : nowISO();
      rebuildTermIndex();
      cacheLocal();
      if (dirtyEntries.size || dirtyAppState) await flushSyncNow();
      else setSync("ok");
    } catch (err) {
      console.warn("[pilsa] pull failed", err);
      setSync(online ? "ok" : "offline");
    }
  }
  let syncBusy = false, syncAgain = false;
  async function flushSyncNow() {
    if (!user) return;
    if (!online) { setSync("offline"); return; }
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    setSync("syncing");
    try {
      // deletes
      for (const id of [...deletedEntries]) {
        const { error } = await sb.from("entries").delete().eq("id", id);
        if (!error) deletedEntries.delete(id);
      }
      // upserts
      const ids = [...dirtyEntries];
      for (const id of ids) {
        const e = findEntry(id);
        if (!e) { dirtyEntries.delete(id); continue; }
        const { error } = await sb.from("entries").upsert(entryToRow(e), { onConflict: "id" });
        if (!error) dirtyEntries.delete(id);
      }
      if (dirtyAppState) {
        const { data, error } = await sb.from("app_state").upsert(
          { user_id: user.id, terms: state.terms, settings: state.settings, updated_at: nowISO() }, { onConflict: "user_id" }
        ).select().maybeSingle();
        if (!error) { dirtyAppState = false; if (data) state.__appUpdatedAt = data.updated_at; }
      }
      setSync(dirtyEntries.size || dirtyAppState ? "offline" : "ok");
    } catch (err) {
      console.warn("[pilsa] sync failed", err);
      setSync("offline");
    } finally {
      syncBusy = false;
      if (syncAgain) { syncAgain = false; flushSyncNow(); }
    }
  }
  const scheduleSync = debounce(flushSyncNow, SAVE_DEBOUNCE);
  function setSync(s) {
    const d = $("syncDot"); if (!d) return;
    d.className = "sync-dot" + (s === "syncing" ? " syncing" : s === "offline" ? " offline" : s === "ok" ? " ok" : "");
    d.title = s === "syncing" ? "동기화 중…" : s === "offline" ? "오프라인 — 로컬에만 저장됨" : s === "ok" ? "동기화됨" : "";
  }
  async function beaconFlush() {
    // best-effort save on the way out
    cacheLocal();
    if (!user || !online || (!dirtyEntries.size && !dirtyAppState && !deletedEntries.size)) return;
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) return;
      const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}`, Prefer: "resolution=merge-duplicates" };
      const rows = [...dirtyEntries].map(findEntry).filter(Boolean).map(entryToRow);
      if (rows.length) fetch(`${SUPABASE_URL}/rest/v1/entries?on_conflict=id`, { method: "POST", headers, body: JSON.stringify(rows), keepalive: true });
      if (dirtyAppState) fetch(`${SUPABASE_URL}/rest/v1/app_state?on_conflict=user_id`, { method: "POST", headers, body: JSON.stringify([{ user_id: user.id, terms: state.terms, settings: state.settings, updated_at: nowISO() }]), keepalive: true });
    } catch (_) {}
  }

  /* ─────────────────────── DOM REFS ─────────────────────── */
  const D = {};
  function bindRefs() {
    [
      "authView","authForm","authEmail","authPassword","authSubmit","authMsg","authSwitch","authNote",
      "app","sidebar","sidebarToggle","wordmark","syncDot","newEntryBtn","searchBtn","wordsBtn","sentencesBtn",
      "wordsCount","sentencesCount","recentList","exportBtn","importBtn","signOutBtn","importInput","sidebarReopen","main",
      "emptyState","emptyNewBtn","entryView","entryDate","entryWeekday","entryStatus","deleteEntryBtn","srcAuthor","srcTitle","srcPage",
      "bodyField","bodyRender","bodyEditWrap","bodyBackdrop","bodyInput","hlToolbar","slashMenu","slashMenuList","bodyHint","interpInput","interpSend","interpRevisions",
      "claudePanel","claudeHead","claudeTitle","claudeChevron","claudeBody","threadList","claudeCompose","claudeInput","claudeSend","claudeWarn",
      "reflectView","reflectDate","reflectWeekday","reflectStatus","reflectDeleteBtn","reflectAuthor","reflectTitle",
      "reflectModes","reflectModeDesc","reflectBody","reflectSend","reflectRevCount",
      "reflectResponse","reflectCorrected","reflectErrorsH","reflectErrors","reflectRespTs",
      "wordsView","wordsSub","wordsFilter","wordsSort","wordsGrid","sentencesView","sentencesSub","sentencesFilter","sentenceList",
      "thoughtsBtn","thoughtsCount","thoughtsView","thoughtsSub","thoughtsFilter","thoughtList",
      "projectsBtn","projectsCount","projectsView","projectsSort","projectsFilter","projectsGrid","projectsKindFilter","projectsNewBtn",
      "projectDetailView","projectBackBtn","projectCuratorEditBtn","projectArtScroll",
      "searchScrim","searchInput","searchClose","searchFilters","chipColor","chipClaude","chipFrom","chipTo","chipAuthor","searchResults",
      "modalScrim","modalClose","modalTitle","modalBody","modalActions","wordTip","toast",
    ].forEach((id) => (D[id] = $(id)));
  }

  /* ─────────────────────── TOAST / MODAL ─────────────────────── */
  let toastTimer;
  function toast(msg) {
    D.toast.textContent = msg; D.toast.hidden = false; void D.toast.offsetWidth; D.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { D.toast.classList.remove("show"); setTimeout(() => (D.toast.hidden = true), 260); }, 2600);
  }
  function flashStatus(msg) {
    D.entryStatus.textContent = msg; D.entryStatus.classList.add("show");
    clearTimeout(flashStatus._t); flashStatus._t = setTimeout(() => D.entryStatus.classList.remove("show"), 1700);
  }
  function openModal(title, bodyHtmlOrNode, actions) {
    D.modalTitle.textContent = title;
    D.modalBody.innerHTML = "";
    if (typeof bodyHtmlOrNode === "string") D.modalBody.innerHTML = bodyHtmlOrNode;
    else if (bodyHtmlOrNode) D.modalBody.appendChild(bodyHtmlOrNode);
    if (actions && actions.length) {
      D.modalActions.innerHTML = "";
      actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = "modal-btn " + (a.primary ? "modal-btn--primary" : "modal-btn--ghost");
        b.textContent = a.label;
        b.addEventListener("click", () => { if (a.onClick) a.onClick(); if (a.close !== false) closeModal(); });
        D.modalActions.appendChild(b);
      });
      D.modalActions.hidden = false;
    } else D.modalActions.hidden = true;
    D.modalScrim.hidden = false;
  }
  function closeModal() { D.modalScrim.hidden = true; D.modalBody.innerHTML = ""; }

  /* ─────────────────────── ROUTER ─────────────────────── */
  function parseHash() {
    const h = location.hash || "#daily";
    const parts = h.replace(/^#/, "").split("/");
    return { name: parts[0] || "daily", arg: parts.slice(1).map(decodeURIComponent) };
  }
  function go(hash) { if (location.hash === hash) renderRoute(); else location.hash = hash; }
  function renderRoute() {
    if (!user) return;
    const { name } = parseHash();
    [D.emptyState, D.entryView, D.reflectView, D.wordsView, D.sentencesView, D.thoughtsView, D.projectsView, D.projectDetailView].forEach((v) => (v.hidden = true));
    D.searchScrim.hidden = true;
    [D.searchBtn, D.wordsBtn, D.sentencesBtn, D.thoughtsBtn, D.projectsBtn].forEach((b) => b.classList.remove("is-on"));
    if (name === "words") { D.wordsBtn.classList.add("is-on"); D.wordsView.hidden = false; renderWordsView(); }
    else if (name === "sentences") { D.sentencesBtn.classList.add("is-on"); D.sentencesView.hidden = false; renderSentencesView(); }
    else if (name === "thoughts") { D.thoughtsBtn.classList.add("is-on"); D.thoughtsView.hidden = false; renderThoughtsView(); }
    else if (name === "projects" || name === "art") {
      // legacy #art redirects to projects grid
      D.projectsBtn.classList.add("is-on");
      const { arg } = parseHash();
      if (name === "projects" && arg && arg.length) { D.projectDetailView.hidden = false; renderProjectDetailView(arg[0]); }
      else { D.projectsView.hidden = false; renderProjectsView(); }
    }
    else { showDaily(); }
    if (name !== "daily" && name !== "") D.main.scrollTop = 0;
  }
  function showDaily() {
    D.main.scrollTop = 0;
    if (!state.entries.length) { D.emptyState.hidden = false; D.entryView.hidden = true; D.reflectView.hidden = true; return; }
    if (!currentEntry()) {
      let openId = null;
      try { openId = localStorage.getItem(lastOpenKey()); } catch (_) {}
      currentId = openId && findEntry(openId) ? openId : (orderedEntries()[0] || {}).id || null;
    }
    const e = currentEntry();
    if (!e) { D.emptyState.hidden = false; return; }
    D.emptyState.hidden = true;
    if (e.kind === "reflection") {
      D.entryView.hidden = true; D.reflectView.hidden = false;
      renderReflectEntry();
    } else {
      D.reflectView.hidden = true; D.entryView.hidden = false;
      renderEntry();
    }
  }

  /* ─────────────────────── DAILY: ENTRY ─────────────────────── */
  function rememberOpen() { try { if (currentId) localStorage.setItem(lastOpenKey(), currentId); } catch (_) {} }

  function newEntry(kind, presetSource) {
    // No-arg call (e.g. from button click — event is the arg) → open picker
    if (typeof kind !== "string") { openNewDocPicker(); return; }
    captureInterpCorrection();
    const e = blankEntry(kind);
    if (presetSource && typeof presetSource === "object") {
      if (typeof presetSource.author === "string") e.source.author = presetSource.author;
      if (typeof presetSource.title === "string") e.source.title = presetSource.title;
      if (typeof presetSource.page === "string") e.source.page = presetSource.page;
    }
    state.entries.push(e);
    currentId = e.id; activeThreadId = null;
    touchEntry(e); rememberOpen();
    if (parseHash().name !== "daily") location.hash = "#daily";
    else { showDaily(); renderRecentList(); }
    renderSidebarCounts();
    autoCloseSidebarIfNarrow();
    // Focus where it makes sense: if a project was pre-set, jump into the body so the user starts writing
    if (presetSource && (presetSource.author || presetSource.title)) {
      setTimeout(() => {
        try {
          if (kind === "reflection") D.reflectBody.focus();
          else D.bodyInput.focus();
        } catch (_) {}
      }, 0);
    } else if (kind === "reflection") setTimeout(() => { try { D.reflectAuthor.focus(); } catch (_) {} }, 0);
    else D.srcAuthor.focus();
  }
  function openNewDocPicker() {
    const wrap = document.createElement("div");
    wrap.className = "doc-picker";
    wrap.innerHTML =
      `<button type="button" class="doc-picker-card" data-kind="transcription">
        <span class="doc-picker-name">필사</span>
        <span class="doc-picker-desc">남의 글을 옮겨 적고 해석합니다.<br/>본문 · 하이라이트 · 한국어 해석 · △ 묻기.</span>
        <span class="doc-picker-kbd">⌘1</span>
      </button>
      <button type="button" class="doc-picker-card" data-kind="reflection">
        <span class="doc-picker-name">사유</span>
        <span class="doc-picker-desc">내 생각을 직접 적고 다듬습니다.<br/>영어·한국어 자유. Claude가 교정·지적해 줍니다.</span>
        <span class="doc-picker-kbd">⌘2</span>
      </button>`;
    function pick(kind) { closeModal(); document.removeEventListener("keydown", onKey, true); newEntry(kind); }
    wrap.addEventListener("click", (ev) => {
      const card = ev.target.closest(".doc-picker-card");
      if (card) pick(card.dataset.kind);
    });
    function onKey(ev) {
      if (D.modalScrim.hidden) { document.removeEventListener("keydown", onKey, true); return; }
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === "1" || ev.key === "2")) {
        ev.preventDefault();
        pick(ev.key === "1" ? "transcription" : "reflection");
      }
    }
    document.addEventListener("keydown", onKey, true);
    openModal("어떤 문서를 시작할까요?", wrap);
  }
  function openEntry(id) {
    if (id === currentId && parseHash().name === "daily") return;
    captureInterpCorrection();
    if (!findEntry(id)) return;
    currentId = id; activeThreadId = null; editing = false; rememberOpen();
    if (parseHash().name !== "daily") location.hash = "#daily";
    else { showDaily(); renderRecentList(); }
    autoCloseSidebarIfNarrow();
  }
  function deleteCurrentEntry() {
    const e = currentEntry(); if (!e) return;
    const kindLabel = e.kind === "reflection" ? "사유" : "필사";
    const label = srcLabel(e) || e.date;
    if (!confirm(`이 ${kindLabel}을(를) 삭제할까요?\n\n${label}\n\n되돌릴 수 없습니다.`)) return;
    state.entries = state.entries.filter((x) => x.id !== e.id);
    deletedEntries.add(e.id); dirtyEntries.delete(e.id);
    pruneEntryFromTerms(e.id);
    const nx = orderedEntries()[0];
    currentId = nx ? nx.id : null;
    scheduleSync(); cacheLocal();
    renderRecentList(); showDaily(); renderSidebarCounts();
    toast(`${kindLabel}을 삭제했습니다`);
  }
  function srcLabel(e) {
    const p = [e.source.author, e.source.title].filter(Boolean);
    let s = p.join(" · ");
    if (e.source.page) s += (s ? " · " : "") + pageRef(e.source.page);
    return s;
  }

  function renderEntry() {
    const e = currentEntry(); if (!e) return;
    D.entryDate.value = e.date;
    D.entryWeekday.textContent = weekdayOf(e.date) ? "· " + weekdayOf(e.date) : "";
    D.entryStatus.textContent = ""; D.entryStatus.classList.remove("show");
    D.srcAuthor.value = e.source.author; D.srcTitle.value = e.source.title; D.srcPage.value = e.source.page;
    editing = false;
    D.bodyEditWrap.hidden = true; D.bodyRender.hidden = false;
    renderBodyRead();
    D.interpInput.value = e.interpretation; interpSnapshot = e.interpretation; autoGrow(D.interpInput);
    D.interpSend.disabled = false;
    { const isl = D.interpSend.querySelector(".interp-send-label"); if (isl) isl.textContent = "Claude에게 보내기"; }
    renderInterpRevisions();
    hideToolbar(); hideWordTip();
    // claude panel
    activeThreadId = null;
    setComposeAnchor(null);
    renderThreads();
    renderClaudeHead();
    D.claudeInput.value = ""; autoGrow(D.claudeInput, 160);
    D.claudeWarn.hidden = true;
    D.claudePanel.classList.remove("open"); D.claudeBody.hidden = true;
  }

  /* ── reflection (사유) entry ── */
  let reflectBusy = false;
  function modeDesc(m) {
    if (m === "expand") return "(곧) 교정 + 대안 표현 + 요지";
    if (m === "deep") return "(곧) 교정 + 대안 + 요지 + 되묻는 질문";
    return "문법·표현 교정과 한국어 설명";
  }
  function renderReflectEntry() {
    const e = currentEntry(); if (!e || e.kind !== "reflection") return;
    if (!e.reflection || typeof e.reflection !== "object") e.reflection = { mode: "correct", body: "", revisions: [] };
    const r = e.reflection;

    D.reflectDate.value = e.date;
    D.reflectWeekday.textContent = weekdayOf(e.date) ? "· " + weekdayOf(e.date) : "";
    D.reflectStatus.textContent = ""; D.reflectStatus.classList.remove("show");
    D.reflectAuthor.value = e.source.author;
    D.reflectTitle.value = e.source.title;
    D.reflectBody.value = r.body;

    D.reflectModes.querySelectorAll(".reflect-mode").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.mode === r.mode);
    });
    D.reflectModeDesc.textContent = modeDesc(r.mode);

    D.reflectSend.disabled = reflectBusy;
    { const lbl = D.reflectSend.querySelector(".reflect-send-label"); if (lbl) lbl.textContent = reflectBusy ? "보내는 중…" : "Claude에게 보내기"; }
    D.reflectRevCount.textContent = r.revisions.length ? `${r.revisions.length}회 보냄` : "";

    const last = r.revisions.length ? r.revisions[r.revisions.length - 1] : null;
    renderReflectResponse(last);
  }
  function renderReflectResponse(rev) {
    if (!rev) { D.reflectResponse.hidden = true; return; }
    D.reflectResponse.hidden = false;
    D.reflectCorrected.textContent = rev.corrected || "(교정본 없음)";
    if (rev.errors && rev.errors.length) {
      D.reflectErrorsH.hidden = false;
      D.reflectErrors.innerHTML = rev.errors.map((er) =>
        `<li><span class="reflect-err-tag">${esc(er.tag)}</span><span class="reflect-err-detail">${esc(er.detail)}</span></li>`
      ).join("");
    } else {
      D.reflectErrorsH.hidden = true;
      D.reflectErrors.innerHTML = `<li><span class="reflect-err-tag" style="background:transparent;border:none;color:var(--color-text-tertiary);padding:0;">— 지적할 것이 없습니다.</span></li>`;
    }
    D.reflectRespTs.textContent = rev.timestamp ? fmtDate(rev.timestamp) + " " + String(rev.timestamp).slice(11, 16) : "";
  }
  async function sendReflection(modeArg) {
    if (reflectBusy) return;
    const e = currentEntry(); if (!e || e.kind !== "reflection") return;
    if (!e.reflection) e.reflection = { mode: "correct", body: "", revisions: [] };
    const r = e.reflection;
    r.body = D.reflectBody.value;
    const text = r.body.trim();
    if (!text) { D.reflectBody.focus(); toast("먼저 본문을 적어 주세요"); return; }
    const mode = modeArg === "expand" || modeArg === "deep" ? modeArg : "correct"; // only 'correct' actually supported on the server for now
    r.mode = mode;
    touchEntry(e);

    reflectBusy = true;
    D.reflectSend.disabled = true;
    const lbl = D.reflectSend.querySelector(".reflect-send-label");
    if (lbl) lbl.textContent = "보내는 중…";

    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) throw new Error("로그인이 필요합니다");
      const context = { author: e.source.author || "", title: e.source.title || "" };
      const resp = await fetch(CLAUDE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ messages: [{ role: "user", content: text }], context, reflect: mode }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || out.error) throw new Error((out && out.error) ? out.error : `요청 실패 (${resp.status})`);
      const rr = out.reflect || {};
      const rev = normRevision({
        timestamp: nowISO(), mode,
        input: text,
        corrected: rr.corrected || "",
        errors: rr.errors || [],
        expressions: rr.expressions || [],
        summary: rr.summary || "",
        questions: rr.questions || [],
      });
      r.revisions.push(rev);
      touchEntry(e);
      renderReflectResponse(rev);
      D.reflectRevCount.textContent = `${r.revisions.length}회 보냄`;
      toast("교정 완료");
      setTimeout(() => { try { D.reflectResponse.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {} }, 30);
    } catch (err) {
      toast("Claude 호출 실패 — " + (err.message || String(err)));
    } finally {
      reflectBusy = false;
      D.reflectSend.disabled = false;
      if (lbl) lbl.textContent = "Claude에게 보내기";
    }
  }

  /* ── body: read-mode rendering ── */
  function termWrap(seg) {
    if (!seg) return "";
    if (!termWords.size) return esc(seg);
    let out = "", last = 0, m;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(seg))) {
      out += esc(seg.slice(last, m.index));
      const w = m[0], n = normWord(w);
      if (n && termWords.has(n)) out += `<span class="term-mark hl-yellow" data-term="${escAttr(n)}">${esc(w)}</span>`;
      else out += esc(w);
      last = m.index + w.length;
      if (m.index === wordRe.lastIndex) wordRe.lastIndex++;
    }
    out += esc(seg.slice(last));
    return out;
  }
  function markAttrs(hl, e) {
    const txt = e.body.slice(hl.startChar, hl.endChar);
    const n = normWord(txt);
    const isTerm = n && termWords.has(n);
    let cls = `hl-${hl.type}` + (isTerm ? " term-mark" : "");
    let a = ` class="${cls}"`;
    if (isTerm) a += ` data-term="${escAttr(n)}"`;
    if (hl.note) a += ` data-note="${escAttr(hl.note)}"`;
    a += ` data-hl="${escAttr(hl.id)}"`;
    return a;
  }
  // Line-aware rendering: each text line becomes its own <div class="line line-…">.
  // Block kinds are detected by line prefixes (`# `, `## `, `> `) or a divider pattern.
  // Highlights are split at `\n` boundaries so marks never cross line divs.
  function buildBodyHtml(e, opts) {
    opts = opts || {};
    const text = e.body;
    if (!text) return "";
    const splitHls = [];
    for (const h of (e.highlights || [])) {
      if (!(h.endChar > h.startChar)) continue;
      let s = clamp(h.startChar, 0, text.length);
      const e2 = clamp(h.endChar, 0, text.length);
      while (s < e2) {
        const nl = text.indexOf("\n", s);
        const segEnd = nl === -1 || nl >= e2 ? e2 : nl;
        if (segEnd > s) splitHls.push({ ...h, startChar: s, endChar: segEnd });
        if (nl === -1 || nl >= e2) break;
        s = nl + 1;
      }
    }
    splitHls.sort((a, b) => a.startChar - b.startChar);
    const cleanHls = []; let lastEnd = -1;
    for (const h of splitHls) { if (h.startChar >= lastEnd) { cleanHls.push(h); lastEnd = h.endChar; } }
    const events = [];
    for (const h of cleanHls) {
      events.push({ pos: h.startChar, k: 2, hl: h });
      events.push({ pos: h.endChar,   k: 0, hl: h });
    }
    for (const t of (e.threads || [])) {
      if (Number.isFinite(t.anchorChar)) events.push({ pos: clamp(t.anchorChar, 0, text.length), k: 1, thread: t });
    }
    events.sort((a, b) => a.pos - b.pos || a.k - b.k);

    const lines = text.split("\n");
    let html = "", evIdx = 0, charPos = 0;
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      const lineStart = charPos;
      const lineEnd   = charPos + L.length;
      const trimmed = L.trim();
      let cls = "line line-para", isDivider = false;
      if (/^# /.test(L))        cls = "line line-h1";
      else if (/^## /.test(L))  cls = "line line-h2";
      else if (/^> /.test(L))   cls = "line line-quote";
      else if (trimmed && /^(?:·\s*){2,}·?\s*$|^[─—\-]{3,}\s*$/.test(trimmed)) { cls = "line line-divider"; isDivider = true; }
      if (isDivider) {
        while (evIdx < events.length && events[evIdx].pos <= lineEnd) evIdx++;
        html += `<div class="${cls}" aria-hidden="true"><hr></div>`;
        charPos = lineEnd + 1;
        continue;
      }
      let lineHtml = "", cur = lineStart, inHl = null;
      while (evIdx < events.length && events[evIdx].pos <= lineEnd) {
        const x = events[evIdx];
        const seg = text.slice(cur, x.pos);
        lineHtml += inHl ? esc(seg) : termWrap(seg);
        cur = x.pos;
        if (x.k === 2)      { inHl = x.hl; lineHtml += `<mark${markAttrs(x.hl, e)}>`; }
        else if (x.k === 0) { lineHtml += "</mark>"; inHl = null; }
        else if (x.k === 1) { lineHtml += `<sup class="thread-anchor" data-thread="${escAttr(x.thread.id)}" title="Claude 대화"></sup>`; }
        evIdx++;
      }
      const tail = text.slice(cur, lineEnd);
      lineHtml += inHl ? esc(tail) : termWrap(tail);
      if (inHl) { lineHtml += "</mark>"; inHl = null; }
      if (!lineHtml) lineHtml = "&#8203;"; // keep empty lines tall enough
      html += `<div class="${cls}">${lineHtml}</div>`;
      charPos = lineEnd + 1;
    }
    return html;
  }
  function renderBodyRead() {
    const e = currentEntry(); if (!e) return;
    D.bodyRender.innerHTML = buildBodyHtml(e);
  }

  /* ── body: edit mode ── */
  function enterEdit(caretOffset) {
    const e = currentEntry(); if (!e || editing) return;
    editing = true;
    D.bodyRender.hidden = true; D.bodyEditWrap.hidden = false;
    D.bodyInput.value = e.body;
    renderBackdrop();
    D.bodyInput.focus();
    const o = caretOffset == null ? 0 : clamp(caretOffset, 0, e.body.length);
    try { D.bodyInput.setSelectionRange(o, o); } catch (_) {}
  }
  function exitEdit() {
    if (!editing) return;
    editing = false;
    const e = currentEntry();
    if (e) e.body = D.bodyInput.value; // ensure synced
    D.bodyEditWrap.hidden = true; D.bodyRender.hidden = false;
    renderBodyRead();
    hideToolbar();
    closeSlashMenu();
  }
  function renderBackdrop() {
    const e = currentEntry();
    const text = D.bodyInput.value;
    let html;
    if (!e || !e.highlights.length) html = esc(text);
    else {
      const hls = [...e.highlights].map((h) => ({ ...h, startChar: clamp(h.startChar, 0, text.length), endChar: clamp(h.endChar, 0, text.length) }))
        .filter((h) => h.endChar > h.startChar).sort((a, b) => a.startChar - b.startChar);
      let out = "", cur = 0;
      for (const h of hls) { if (h.startChar < cur) continue; out += esc(text.slice(cur, h.startChar)); out += `<mark class="hl-${h.type}">${esc(text.slice(h.startChar, h.endChar))}</mark>`; cur = h.endChar; }
      out += esc(text.slice(cur));
      html = out;
    }
    if (text.endsWith("\n")) html += " ";
    D.bodyBackdrop.innerHTML = html;
  }
  function remapHighlights(oldT, newT, hls) {
    if (oldT === newT || !hls.length) return hls;
    const oL = oldT.length, nL = newT.length;
    let p = 0; const mp = Math.min(oL, nL);
    while (p < mp && oldT.charCodeAt(p) === newT.charCodeAt(p)) p++;
    let s = 0; const ms = Math.min(oL - p, nL - p);
    while (s < ms && oldT.charCodeAt(oL - 1 - s) === newT.charCodeAt(nL - 1 - s)) s++;
    const oEnd = oL - s, delta = nL - oL;
    const out = [];
    for (const h of hls) {
      if (h.endChar <= p) out.push(h);
      else if (h.startChar >= oEnd) out.push({ ...h, startChar: h.startChar + delta, endChar: h.endChar + delta });
    }
    return out;
  }
  function onBodyInput() {
    const e = currentEntry(); if (!e) return;
    const oldT = e.body, newT = D.bodyInput.value;
    e.highlights = remapHighlights(oldT, newT, e.highlights);
    // remap thread anchors too
    if (oldT !== newT) {
      let p = 0; const mp = Math.min(oldT.length, newT.length);
      while (p < mp && oldT.charCodeAt(p) === newT.charCodeAt(p)) p++;
      let s = 0; const ms = Math.min(oldT.length - p, newT.length - p);
      while (s < ms && oldT.charCodeAt(oldT.length - 1 - s) === newT.charCodeAt(newT.length - 1 - s)) s++;
      const oEnd = oldT.length - s, delta = newT.length - oldT.length;
      for (const t of e.threads) if (Number.isFinite(t.anchorChar)) {
        if (t.anchorChar <= p) {} else if (t.anchorChar >= oEnd) t.anchorChar += delta; else t.anchorChar = p;
      }
    }
    e.body = newT;
    if (!slashOpen) hideToolbar();
    renderBackdrop();
    touchEntry(e);
    // slash menu: open on freshly typed `/`, otherwise update filter/close
    if (slashOpen) updateSlash();
    else maybeOpenSlash();
  }

  /* ── highlight / ask toolbar ── */
  let pendingSel = null;
  function hideToolbar() { D.hlToolbar.hidden = true; pendingSel = null; }
  function selOverlapsHl(s, e2) { const e = currentEntry(); return !!e && e.highlights.some((h) => h.startChar < e2 && h.endChar > s); }
  function measureRange(s, e2) {
    const text = D.bodyInput.value;
    const pre = esc(text.slice(0, s)), mid = esc(text.slice(s, e2)) || "​";
    let post = esc(text.slice(e2)); if (text.endsWith("\n")) post += " ";
    D.bodyBackdrop.innerHTML = pre + '<span class="__probe">' + mid + "</span>" + post;
    const probe = D.bodyBackdrop.querySelector(".__probe");
    const pr = probe.getBoundingClientRect(), fr = D.bodyField.getBoundingClientRect(), mr = D.main.getBoundingClientRect();
    renderBackdrop();
    return { pr, fr, mr };
  }
  function showToolbarFor(s, e2) {
    pendingSel = { s, e: e2 };
    D.hlToolbar.querySelector(".hl-btn--clear").hidden = !selOverlapsHl(s, e2);
    D.hlToolbar.hidden = false;
    const { pr, fr, mr } = measureRange(s, e2);
    const th = D.hlToolbar.offsetHeight || 32;
    const below = pr.top - mr.top < th + 16;
    let left = pr.left - fr.left + Math.min(pr.width, 240) / 2;
    left = clamp(left, 80, Math.max(80, fr.width - 80));
    if (below) { D.hlToolbar.style.top = pr.bottom - fr.top + 8 + "px"; D.hlToolbar.style.transform = "translateX(-50%)"; }
    else { D.hlToolbar.style.top = pr.top - fr.top - 8 + "px"; D.hlToolbar.style.transform = "translate(-50%, -100%)"; }
    D.hlToolbar.style.left = left + "px";
  }
  function onBodySelChange() {
    if (!editing) return;
    const s = D.bodyInput.selectionStart, e2 = D.bodyInput.selectionEnd;
    if (s == null || s === e2) { hideToolbar(); return; }
    showToolbarFor(s, e2);
  }
  function applyHighlight(type) {
    const sel = pendingSel, e = currentEntry();
    if (!sel || !e) return;
    if (type === "ask") { askClaudeAbout(sel.s, sel.e); return; }
    const frag = type === "yellow" || type === "blue" ? e.body.slice(sel.s, sel.e).trim() : "";
    e.highlights = e.highlights.filter((h) => h.endChar <= sel.s || h.startChar >= sel.e);
    if (type !== "clear") {
      const hl = { id: uid(), startChar: sel.s, endChar: sel.e, type, note: "" };
      e.highlights.push(hl);
      if (type === "yellow") upsertEncounter(e, hl);
    }
    touchEntry(e);
    renderBackdrop();
    hideToolbar();
    if (frag) {
      appendToInterp(frag);
    } else {
      try { D.bodyInput.focus(); D.bodyInput.setSelectionRange(sel.e, sel.e); } catch (_) {}
    }
    flashStatus(type === "clear" ? "표시 지움" : "표시됨");
  }
  // append "<fragment> : " to the interp input, focus there, place caret after ": "
  function appendToInterp(frag) {
    const e = currentEntry(); if (!e) return;
    const cur = D.interpInput.value;
    const needsBreak = cur.length > 0 && !/\n\s*$/.test(cur);
    const insert = (needsBreak ? "\n" : "") + frag + " : ";
    const newVal = cur + insert;
    D.interpInput.value = newVal;
    e.interpretation = newVal;
    autoGrow(D.interpInput);
    touchEntry(e);
    D.interpInput.focus();
    const caret = newVal.length;
    try { D.interpInput.setSelectionRange(caret, caret); } catch (_) {}
    interpSnapshot = newVal;
    D.interpInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function askClaudeAbout(s, e2) {
    const e = currentEntry(); if (!e) return;
    const anchorText = e.body.slice(s, e2).trim();
    const th = { id: uid(), anchorChar: s, anchorText, createdAt: nowISO(), updatedAt: nowISO(), messages: [] };
    e.threads.push(th);
    touchEntry(e);
    hideToolbar();
    exitEdit();           // back to read mode → shows the △
    activeThreadId = th.id;
    openClaudePanel(true);
    renderThreads();
    setComposeAnchor(th);
    D.claudeInput.focus();
    D.claudePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ── slash menu (Notion-like block insertion in the body editor) ── */
  const SLASH_BLOCKS = [
    { key: "para",    label: "단락",     hint: "빈 줄로 새 단락 시작",      icon: "¶",  ins: "\n\n",            keys: ["단락","문단","paragraph","para","p"] },
    { key: "h1",      label: "큰 제목",   hint: "한 줄짜리 제목",            icon: "H1", ins: "\n\n# ",           keys: ["큰제목","heading","title","h1","#"] },
    { key: "h2",      label: "작은 제목", hint: "한 줄짜리 소제목",          icon: "H2", ins: "\n\n## ",          keys: ["작은제목","소제목","subheading","h2","##"] },
    { key: "quote",   label: "인용",     hint: "이탤릭 인용 블록",          icon: "❝",  ins: "\n\n> ",           keys: ["인용","quote","blockquote","q",">"] },
    { key: "divider", label: "구분선",   hint: "두 단락 사이 가는 줄",       icon: "—",  ins: "\n\n· · ·\n\n",    keys: ["구분선","divider","line","hr","---","···"] },
  ];
  let slashOpen = false, slashStart = -1, slashFilter = "", slashIndex = 0;

  function filteredSlash() {
    const f = slashFilter.trim().toLowerCase();
    if (!f) return SLASH_BLOCKS.slice();
    return SLASH_BLOCKS.filter((b) =>
      b.keys.some((k) => k.toLowerCase().startsWith(f) || k.toLowerCase().includes(f)) ||
      b.label.toLowerCase().includes(f)
    );
  }
  function renderSlashMenu() {
    const list = filteredSlash();
    if (!list.length) { D.slashMenuList.innerHTML = '<li class="slash-empty">결과 없음</li>'; return; }
    if (slashIndex >= list.length) slashIndex = 0;
    D.slashMenuList.innerHTML = list.map((b, i) =>
      `<li class="slash-item${i === slashIndex ? " is-on" : ""}" data-key="${escAttr(b.key)}">
         <span class="slash-icon">${esc(b.icon)}</span>
         <span class="slash-text"><span class="slash-label">${esc(b.label)}</span><span class="slash-hint">${esc(b.hint)}</span></span>
       </li>`
    ).join("");
  }
  function positionSlashMenu() {
    if (!slashOpen) return;
    const { pr, fr, mr } = measureRange(slashStart, slashStart + 1);
    const mw = D.slashMenu.offsetWidth || 240, mh = D.slashMenu.offsetHeight || 200;
    let left = pr.left - fr.left;
    left = clamp(left, 8, Math.max(8, fr.width - mw - 8));
    let top = pr.bottom - fr.top + 4;
    if (pr.bottom + mh + 16 > mr.bottom) top = pr.top - fr.top - mh - 6; // flip above if not enough room below
    D.slashMenu.style.left = left + "px";
    D.slashMenu.style.top = top + "px";
  }
  function openSlashMenu(slashPos, cursorPos) {
    slashOpen = true;
    slashStart = slashPos;
    slashIndex = 0;
    slashFilter = D.bodyInput.value.slice(slashPos + 1, cursorPos);
    D.slashMenu.hidden = false;
    renderSlashMenu();
    positionSlashMenu();
    hideToolbar(); // don't compete with the highlight toolbar
  }
  function closeSlashMenu() { slashOpen = false; D.slashMenu.hidden = true; slashFilter = ""; slashStart = -1; }
  function maybeOpenSlash() {
    if (!editing || slashOpen) return;
    const v = D.bodyInput.value, pos = D.bodyInput.selectionStart;
    if (pos < 1 || v[pos - 1] !== "/") return;
    // open only at the start of the textarea or after whitespace
    if (pos > 1 && !/\s/.test(v[pos - 2])) return;
    openSlashMenu(pos - 1, pos);
  }
  function updateSlash() {
    if (!slashOpen) return;
    const v = D.bodyInput.value, pos = D.bodyInput.selectionStart;
    if (slashStart < 0 || pos <= slashStart || v[slashStart] !== "/") { closeSlashMenu(); return; }
    const filter = v.slice(slashStart + 1, pos);
    if (/\s|\//.test(filter) || filter.length > 14) { closeSlashMenu(); return; }
    slashFilter = filter; slashIndex = 0;
    renderSlashMenu();
    positionSlashMenu();
  }
  function applySlash(tpl) {
    const text = D.bodyInput.value;
    const start = slashStart, end = D.bodyInput.selectionStart;
    if (start < 0 || end < start) { closeSlashMenu(); return; }
    const before = text.slice(0, start), after = text.slice(end);
    let ins = tpl.ins;
    // avoid stacking blank lines: trim leading \n's already present at the cursor
    const beforeNL = (before.match(/\n*$/) || [""])[0].length;
    const insLeadNL = (ins.match(/^\n*/) || [""])[0].length;
    ins = ins.slice(Math.min(insLeadNL, beforeNL));
    if (start === 0) ins = ins.replace(/^\n+/, "");
    const newText = before + ins + after;
    D.bodyInput.value = newText;
    const caret = before.length + ins.length;
    try { D.bodyInput.setSelectionRange(caret, caret); } catch (_) {}
    closeSlashMenu();
    onBodyInput();
    autoGrowBodyArea();
    D.bodyInput.focus();
  }
  function autoGrowBodyArea() {
    // backdrop drives the field height — rebuild it so the textarea fills correctly
    renderBackdrop();
  }

  /* ── interpretation ── */
  let interpSnapshot = "";
  function captureInterpCorrection() {
    const e = currentEntry(); if (!e) return;
    const before = interpSnapshot, after = D.interpInput.value;
    if (after !== e.interpretation) { e.interpretation = after; touchEntry(e); }
    if (before.trim() !== "" && after !== before) {
      e.corrections.push({ timestamp: nowISO(), previousText: before, newText: after });
      touchEntry(e);
      renderInterpRevisions();
      flashStatus("이전 해석 보존됨");
    }
    interpSnapshot = after;
  }
  function renderInterpRevisions() {
    const e = currentEntry();
    const n = e ? e.corrections.length : 0;
    D.interpRevisions.hidden = n === 0;
    D.interpRevisions.textContent = n ? `${n}번 고쳐 씀 — 이전 해석 보기` : "";
  }
  function showRevisionsModal() {
    const e = currentEntry(); if (!e || !e.corrections.length) return;
    const wrap = document.createElement("div");
    wrap.innerHTML =
      `<p style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:14px;">오역과 수정은 지워지지 않습니다. 아래는 이 필사의 해석이 거쳐 온 자취입니다.</p>` +
      e.corrections.map((c) =>
        `<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:0.5px solid var(--color-border-tertiary);">
          <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-tertiary);margin-bottom:6px;">${esc(fmtDate(c.timestamp))} ${esc((c.timestamp || "").slice(11, 16))}</div>
          <div style="font-family:var(--font-korean);font-size:13.5px;line-height:1.7;color:var(--color-text-tertiary);text-decoration:line-through;text-decoration-thickness:.5px;">${esc(c.previousText) || "<i>(빈 해석)</i>"}</div>
          <div style="font-family:var(--font-korean);font-size:13.5px;line-height:1.7;color:var(--color-text-primary);margin-top:4px;">${esc(c.newText) || "<i>(빈 해석)</i>"}</div>
        </div>`).join("") +
      `<div style="font-family:var(--font-korean);font-size:13.5px;line-height:1.7;color:var(--color-text-primary);">지금: ${esc(e.interpretation) || "<i>(빈 해석)</i>"}</div>`;
    openModal("이전 해석들", wrap);
  }

  /* ── word tooltip ── */
  let tipTimer = null;
  function showWordTip(target) {
    const term = target.getAttribute("data-term");
    const note = target.getAttribute("data-note");
    let html = "";
    if (term) {
      const t = findTerm(term);
      if (t && t.encounters.length) {
        const enc = termEncountersSorted(t)[0];
        const da = daysAgo(enc.date);
        const re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\w'’-]*", "i");
        const ctxHtml = esc(enc.context).replace(re, (m) => `<b>${m}</b>`);
        const ent = findEntry(enc.entryId);
        html += `<div class="wt-label">처음 만난 곳</div>`;
        html += `<div class="wt-when">${da != null ? (da === 0 ? "오늘" : `${da}일 전`) + " · " : ""}${esc(fmtDate(enc.date))}</div>`;
        if (enc.context) html += `<div class="wt-ctx">${ctxHtml}</div>`;
        if (ent) html += `<div class="wt-src">${esc(srcLabel(ent) || "출처 없음")}</div>`;
        if (enc.note) html += `<div class="wt-note">${esc(enc.note)}</div>`;
        const more = t.encounters.length - 1;
        if (more > 0) html += `<div class="wt-more">+ ${more}번 더 만남 · 「나의 단어」에서 보기</div>`;
      }
      if (!html && note) html = `<div class="wt-note" style="border:none;padding:0;">${esc(note)}</div>`;
      if (!html) html = `<div class="wt-label">아는 단어</div><div class="wt-note" style="border:none;padding:0;">사전에 기록된 단어입니다.</div>`;
    } else if (note) {
      html = `<div class="wt-label">메모</div><div class="wt-note" style="border:none;padding:0;">${esc(note)}</div>`;
    }
    if (!html) return;
    D.wordTip.innerHTML = html;
    D.wordTip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = D.wordTip.offsetWidth, twh = D.wordTip.offsetHeight;
    let left = r.left + window.scrollX + r.width / 2 - tw / 2;
    left = clamp(left, 8 + window.scrollX, window.scrollX + document.documentElement.clientWidth - tw - 8);
    let top = r.bottom + window.scrollY + 7;
    if (r.bottom + twh + 12 > document.documentElement.clientHeight) top = r.top + window.scrollY - twh - 7;
    D.wordTip.style.left = left + "px";
    D.wordTip.style.top = top + "px";
  }
  function hideWordTip() { D.wordTip.hidden = true; clearTimeout(tipTimer); }

  /* ─────────────────────── CLAUDE PANEL ─────────────────────── */
  function renderClaudeHead() {
    const e = currentEntry();
    const n = e ? e.threads.reduce((a, t) => a + t.messages.length, 0) : 0;
    const tcount = e ? e.threads.length : 0;
    D.claudeTitle.textContent = tcount ? `Claude 대화 · ${tcount}개 · ${n}개 메시지` : "Claude 대화";
  }
  function openClaudePanel(forceOpen) {
    if (forceOpen || D.claudeBody.hidden) { D.claudeBody.hidden = false; D.claudePanel.classList.add("open"); }
  }
  function toggleClaudePanel() {
    const willOpen = D.claudeBody.hidden;
    D.claudeBody.hidden = !willOpen;
    D.claudePanel.classList.toggle("open", willOpen);
  }
  let composeAnchor = null;
  function setComposeAnchor(thread) {
    composeAnchor = thread || null;
    let chip = D.claudeCompose.querySelector(".compose-chip");
    if (composeAnchor && composeAnchor.anchorText) {
      if (!chip) {
        chip = document.createElement("div");
        chip.className = "compose-chip";
        chip.style.cssText = "position:absolute;left:12px;top:-22px;font-size:11px;color:var(--color-text-tertiary);max-width:80%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        D.claudeCompose.style.position = "relative";
        D.claudeCompose.appendChild(chip);
      }
      chip.innerHTML = `△ <span style="font-style:italic;font-family:var(--font-serif);">${esc(composeAnchor.anchorText)}</span> 에 대해 묻는 중 · <span style="text-decoration:underline;cursor:pointer;" id="composeChipClear">취소</span>`;
      chip.querySelector("#composeChipClear").addEventListener("click", () => { activeThreadId = null; setComposeAnchor(null); });
    } else if (chip) chip.remove();
  }
  function renderThreads() {
    const e = currentEntry(); if (!e) return;
    renderClaudeHead();
    if (!e.threads.length) { D.threadList.innerHTML = `<div class="list-empty" style="padding:8px 0;">아직 대화가 없습니다. 본문에서 단어·구절을 선택해 “△ 묻기”를 누르거나, 아래에 바로 물어보세요.</div>`; return; }
    const ths = [...e.threads].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    D.threadList.innerHTML = ths.map((t) => {
      const head = t.anchorText
        ? `<div class="thread-anchor-quote" data-jump="${escAttr(t.id)}"><span class="tri">△</span><span class="q">${esc(t.anchorText)}</span><button class="thread-del" data-del="${escAttr(t.id)}">삭제</button></div>`
        : `<div class="thread-anchor-quote" data-jump="${escAttr(t.id)}"><span class="q" style="font-family:var(--font-sans);font-style:normal;color:var(--color-text-tertiary);">${t.fromInterp ? "나의 해석·질문에 대한 Claude" : "이 필사에 대한 일반 질문"}</span><button class="thread-del" data-del="${escAttr(t.id)}">삭제</button></div>`;
      const msgs = t.messages.map((m) => {
        if (m.role === "user") return `<div class="msg role-user"><span class="msg-who">나</span><div class="msg-content">${esc(m.content)}</div></div>`;
        if (m.pending) return `<div class="msg role-assistant pending"><span class="msg-who">Claude</span><div class="msg-content">…생각 중</div></div>`;
        return `<div class="msg role-assistant"><span class="msg-who">Claude</span><div class="msg-content">${mdInline(m.content)}</div></div>`;
      }).join("");
      return `<div class="thread${t.id === activeThreadId ? " is-active" : ""}" data-thread="${escAttr(t.id)}">${head}${msgs}</div>`;
    }).join("");
  }
  function jumpToThread(id) {
    openClaudePanel(true);
    renderThreads();
    activeThreadId = id;
    const th = currentEntry() && currentEntry().threads.find((x) => x.id === id);
    setComposeAnchor(th && th.anchorText ? th : null);
    renderThreads();
    const el = D.threadList.querySelector(`.thread[data-thread="${cssEsc(id)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    D.claudePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function deleteThread(id) {
    const e = currentEntry(); if (!e) return;
    if (!confirm("이 대화를 삭제할까요?")) return;
    e.threads = e.threads.filter((t) => t.id !== id);
    if (activeThreadId === id) { activeThreadId = null; setComposeAnchor(null); }
    touchEntry(e);
    renderThreads(); renderBodyRead();
  }
  function showClaudeWarn(msg) { D.claudeWarn.textContent = msg; D.claudeWarn.hidden = false; }
  let claudeBusy = false;
  async function sendCompose() {
    if (claudeBusy) return;
    const e = currentEntry(); if (!e) return;
    const text = D.claudeInput.value.trim();
    if (!text) return;
    let th = activeThreadId ? e.threads.find((x) => x.id === activeThreadId) : null;
    if (!th) { th = { id: uid(), anchorChar: null, anchorText: "", createdAt: nowISO(), updatedAt: nowISO(), messages: [] }; e.threads.push(th); activeThreadId = th.id; }
    D.claudeInput.value = ""; autoGrow(D.claudeInput, 160);
    D.claudeWarn.hidden = true;
    await runClaude(th, text);
  }
  // file the words/phrases Claude flagged into 나의 단어 / 나의 문장
  function applyPicks(e, picks) {
    if (!e || !Array.isArray(picks) || !picks.length) return null;
    let words = 0, phrases = 0;
    for (const p of picks) {
      if (!p || typeof p !== "object") continue;
      const note = typeof p.note === "string" ? p.note.trim() : "";
      const raw = typeof p.text === "string" ? p.text.trim() : "";
      if (!raw) continue;
      if (p.kind === "word") {
        const span = findWordSpan(e.body, raw);
        let termWord, ctx;
        if (span) {
          termWord = normWord(e.body.slice(span.start, span.end));
          ctx = sentenceAround(e.body, span.start, span.end).text;
          if (termWord && termWord.length >= 2 && !e.highlights.some((h) => h.startChar < span.end && h.endChar > span.start)) {
            e.highlights.push({ id: uid(), startChar: span.start, endChar: span.end, type: "yellow", note: "" });
          }
        } else { termWord = normWord(raw); ctx = sentenceContaining(e.body, raw); }
        if (termWord && termWord.length >= 2) {
          let term = findTerm(termWord);
          if (!term) { term = { id: uid(), word: termWord, definitions: [], encounters: [] }; state.terms.push(term); }
          let enc = term.encounters.find((x) => x.entryId === e.id && (!span || Math.abs(x.charStart - span.start) < 2));
          if (!enc) { enc = { entryId: e.id, date: e.date, context: ctx, note: "", charStart: span ? span.start : 0, charEnd: span ? span.end : 0 }; term.encounters.push(enc); }
          else { if (ctx) enc.context = ctx; enc.date = e.date; if (span) { enc.charStart = span.start; enc.charEnd = span.end; } }
          if (note && !term.definitions.some((d) => String(d).trim() === note)) term.definitions.push(note);
          words++;
        }
      } else {
        const lc = raw.toLowerCase();
        let th = e.threads.find((t) => t.anchorText && t.anchorText.trim().toLowerCase() === lc);
        if (!th) {
          const i = e.body.toLowerCase().indexOf(lc);
          th = { id: uid(), anchorChar: i >= 0 ? i : null, anchorText: i >= 0 ? e.body.slice(i, i + raw.length) : raw, fromInterp: true, createdAt: nowISO(), updatedAt: nowISO(), messages: [] };
          e.threads.push(th);
        }
        if (note && !th.messages.some((m) => m.role === "assistant" && String(m.content).trim() === note)) {
          th.messages.push({ id: uid(), role: "assistant", content: note, timestamp: nowISO() });
        }
        th.updatedAt = nowISO();
        phrases++;
      }
    }
    rebuildTermIndex();
    touchEntry(e); touchAppState();
    return { words, phrases };
  }
  async function runClaude(th, userText, opts) {
    opts = opts || {};
    const e = currentEntry(); if (!e) return;
    if (claudeBusy) return;
    claudeBusy = true;
    th.messages.push({ id: uid(), role: "user", content: userText, timestamp: nowISO() });
    const pending = { id: uid(), role: "assistant", content: "", pending: true, timestamp: nowISO() };
    th.messages.push(pending);
    th.updatedAt = nowISO();
    touchEntry(e);
    openClaudePanel(true);
    renderThreads();
    setComposeAnchor(th.anchorText ? th : null);
    D.claudeSend.disabled = true;
    let added = null;
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const turns = th.messages.filter((m) => !m.pending && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));
      const context = { author: e.source.author, title: e.source.title, page: e.source.page, body: e.body, interpretation: e.interpretation, selection: th.anchorText || null };
      const resp = await fetch(CLAUDE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ messages: turns, context, extract: !!opts.extract }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || out.error) throw new Error((out && out.error) ? out.error : `요청 실패 (${resp.status})`);
      pending.pending = false; pending.content = out.text || "(빈 응답)";
      delete pending.pending;
      if (opts.extract && Array.isArray(out.picks) && out.picks.length) added = applyPicks(e, out.picks);
    } catch (err) {
      th.messages = th.messages.filter((m) => m.id !== pending.id);
      showClaudeWarn("Claude 호출 실패 — " + (err.message || String(err)));
    }
    D.claudeSend.disabled = false;
    claudeBusy = false;
    th.updatedAt = nowISO();
    touchEntry(e);
    if (opts.extract && !editing) renderBodyRead();
    renderThreads();
    renderSidebarCounts();
    if (added && (added.words || added.phrases)) {
      const parts = [];
      if (added.words) parts.push(`단어 ${added.words}개`);
      if (added.phrases) parts.push(`문장 ${added.phrases}개`);
      toast(`Claude가 ${parts.join(" · ")}를 나의 노트에 더했습니다`);
    }
    const el = D.threadList.querySelector(`.thread[data-thread="${cssEsc(th.id)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  async function sendInterpToClaude() {
    if (claudeBusy) return;
    const e = currentEntry(); if (!e) return;
    e.interpretation = D.interpInput.value;
    const text = e.interpretation.trim();
    if (!text) { D.interpInput.focus(); flashStatus("먼저 해석이나 질문을 적어 주세요"); return; }
    let th = e.threads.find((t) => t.fromInterp && !t.anchorText);
    if (!th) { th = { id: uid(), anchorChar: null, anchorText: "", fromInterp: true, createdAt: nowISO(), updatedAt: nowISO(), messages: [] }; e.threads.push(th); }
    const lastUser = [...th.messages].reverse().find((m) => !m.pending && m.role === "user");
    if (lastUser && lastUser.content.trim() === text) { flashStatus("바뀐 내용이 없습니다 — 해석을 고친 뒤 다시 보내세요"); return; }
    activeThreadId = th.id;
    openClaudePanel(true);
    const label = D.interpSend.querySelector(".interp-send-label");
    D.interpSend.disabled = true;
    if (label) label.textContent = "보내는 중…";
    try { await runClaude(th, text, { extract: true }); }
    finally { D.interpSend.disabled = false; if (label) label.textContent = "Claude에게 보내기"; }
    D.claudePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ─────────────────────── RECENT LIST + COUNTS ─────────────────────── */
  function renderRecentList() {
    const items = orderedEntries();
    if (!items.length) { D.recentList.innerHTML = '<li class="recent-empty">아직 없습니다</li>'; return; }
    const today = todayISO();
    D.recentList.innerHTML = items.map((e) => {
      const dot = e.date === today ? '<span class="recent-dot"></span>' : "";
      const lbl = srcLabel(e) || "제목 없음";
      return `<li><button type="button" class="recent-item${e.id === currentId && parseHash().name === "daily" ? " is-active" : ""}" data-id="${escAttr(e.id)}">
        <span class="recent-item-date">${dot}${esc(fmtMD(e.date))}</span>
        <span class="recent-item-src">${esc(lbl)}</span>
      </button></li>`;
    }).join("");
  }
  function renderSidebarCounts() {
    D.wordsCount.textContent = state.terms.length ? String(state.terms.length) : "";
    let sc = 0, tc = 0;
    const projectKeys = new Set();
    for (const e of state.entries) {
      projectKeys.add(projectKey(e));
      if (e.kind === "reflection") { tc++; continue; }
      for (const t of e.threads) if (t.anchorText && t.messages.length) sc++;
    }
    D.sentencesCount.textContent = sc ? String(sc) : "";
    D.thoughtsCount.textContent = tc ? String(tc) : "";
    D.projectsCount.textContent = projectKeys.size ? String(projectKeys.size) : "";
  }

  /* ─────────────────────── 나의 단어 (dictionary) ─────────────────────── */
  let wordsState = { sort: "recent", filter: "", open: null };
  function renderWordsView() {
    D.wordsSub.textContent = `${state.terms.length}개의 단어 · 노란색으로 표시한 단어들이 모입니다`;
    D.wordsSort.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.sort === wordsState.sort));
    D.wordsFilter.value = wordsState.filter;
    let list = state.terms.slice();
    const f = wordsState.filter.trim().toLowerCase();
    if (f) list = list.filter((t) => t.word.includes(f) || t.definitions.some((d) => d.toLowerCase().includes(f)));
    const lastDate = (t) => t.encounters.reduce((m, x) => (x.date > m ? x.date : m), "");
    if (wordsState.sort === "recent") list.sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
    else if (wordsState.sort === "count") list.sort((a, b) => b.encounters.length - a.encounters.length || a.word.localeCompare(b.word));
    else list.sort((a, b) => a.word.localeCompare(b.word));
    if (!list.length) { D.wordsGrid.innerHTML = `<div class="list-empty">${state.terms.length ? "거른 결과가 없습니다." : "아직 표시한 단어가 없습니다. 필사 본문에서 모르는 단어를 드래그해 “단어”로 표시해 보세요."}</div>`; return; }
    D.wordsGrid.innerHTML = list.map((t) => {
      const open = t.id === wordsState.open;
      const last = lastDate(t);
      const card = `<button type="button" class="word-card${open ? " is-open" : ""}" data-word="${escAttr(t.id)}">
        <div class="word-card-w">${esc(t.word)}<span class="cnt">${t.encounters.length}회</span></div>
        <div class="word-card-meta">${t.definitions[0] ? esc(t.definitions[0]) : (last ? "마지막 만남 " + esc(fmtDate(last)) : "")}</div>
      </button>`;
      return card + (open ? renderTermDetail(t) : "");
    }).join("");
  }
  function renderTermDetail(t) {
    const encs = termEncountersSorted(t);
    const claude = termClaudeNotes(t.word);
    const escW = t.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b" + escW + "[\\w'’-]*", "i");
    return `<div class="word-detail" data-detail="${escAttr(t.id)}">
      <div class="word-detail-w">${esc(t.word)}</div>
      <div class="word-detail-defs">
        ${t.definitions.map((d, i) => `<div class="def-row"><span class="num">${i + 1}.</span><span>${esc(d)}</span><button data-defdel="${i}" style="margin-left:auto;font-size:11px;color:var(--color-text-tertiary);">삭제</button></div>`).join("")}
        <div class="def-add"><input data-defadd placeholder="뜻 / 메모 추가…" /><button data-defadd-btn>추가</button></div>
      </div>
      <div class="encounters-label">만남 (${encs.length})</div>
      ${encs.map((enc) => {
        const ent = findEntry(enc.entryId);
        const ctx = enc.context ? esc(enc.context).replace(re, (m) => `<b>${m}</b>`) : "";
        return `<div class="encounter">
          <div class="encounter-date">${esc(fmtDate(enc.date))}</div>
          ${ent ? `<div class="encounter-src">${esc(srcLabel(ent) || "출처 없음")}</div>` : ""}
          ${ctx ? `<div class="encounter-ctx">${ctx}</div>` : ""}
          ${enc.note ? `<div class="encounter-note">${esc(enc.note)}</div>` : ""}
          ${ent ? `<button class="encounter-open" data-open-entry="${escAttr(enc.entryId)}">이 필사 열기 →</button>` : ""}
        </div>`;
      }).join("")}
      ${claude.length ? `<div class="encounters-label" style="margin-top:18px;">Claude가 말한 것 (${claude.length})</div>` +
        claude.map((c) => `<div class="encounter"><div class="encounter-date">${esc(fmtDate(c.entry.date))} · ${esc(srcLabel(c.entry) || "")}</div><div class="encounter-note" style="font-style:normal;">${mdInline(c.msg.content)}</div></div>`).join("") : ""}
    </div>`;
  }

  /* ─────────────────────── 나의 문장 (sentences) ─────────────────────── */
  let sentencesState = { filter: "", open: null };
  function gatherSentences() {
    const out = [];
    for (const e of state.entries) {
      if (e.kind === "reflection") continue;
      for (const t of e.threads) {
        if (!t.anchorText || !t.messages.length) continue;
        out.push({ entry: e, thread: t, text: t.anchorText, date: e.date, createdAt: t.createdAt });
      }
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  }
  function renderSentencesView() {
    const all = gatherSentences();
    D.sentencesSub.textContent = `${all.length}개의 문장 · 내가 묻고 Claude가 답한 것들`;
    D.sentencesFilter.value = sentencesState.filter;
    const f = sentencesState.filter.trim().toLowerCase();
    const list = f ? all.filter((s) => s.text.toLowerCase().includes(f) || srcLabel(s.entry).toLowerCase().includes(f) || s.thread.messages.some((m) => m.content.toLowerCase().includes(f))) : all;
    if (!list.length) {
      D.sentenceList.innerHTML = `<div class="list-empty">${all.length ? "거른 결과가 없습니다." : "아직 없습니다. 필사 본문에서 한 문장을 선택해 “△ 묻기”를 누르면, 그 문장에 대한 내 해석과 Claude의 답이 여기 모입니다."}</div>`;
      return;
    }
    D.sentenceList.innerHTML = list.map((s) => {
      const open = s.thread.id === sentencesState.open;
      const firstA = s.thread.messages.find((m) => m.role === "assistant" && !m.pending);
      const row = `<button type="button" class="sentence-row${open ? " is-open" : ""}" data-sentence="${escAttr(s.thread.id)}">
        <div class="sentence-row-top"><div class="sentence-row-text">${esc(s.text)}</div><div class="sentence-row-date">${esc(fmtDate(s.date))}</div></div>
        <div class="sentence-row-meta"><span>${esc(srcLabel(s.entry) || "출처 없음")}</span><span>· ${s.thread.messages.length}개 메시지</span></div>
        ${firstA ? `<div class="sentence-row-snippet">${esc(firstA.content)}</div>` : ""}
      </button>`;
      return row + (open ? renderSentenceDetail(s) : "");
    }).join("");
  }
  function renderSentenceDetail(s) {
    const e = s.entry, t = s.thread;
    const interp = e.interpretation.trim();
    const msgs = t.messages.map((m) => {
      if (m.role === "user") return `<div class="msg role-user"><span class="msg-who">나</span><div class="msg-content">${esc(m.content)}</div></div>`;
      if (m.pending) return `<div class="msg role-assistant pending"><span class="msg-who">Claude</span><div class="msg-content">…</div></div>`;
      return `<div class="msg role-assistant"><span class="msg-who">Claude</span><div class="msg-content">${mdInline(m.content)}</div></div>`;
    }).join("");
    return `<div class="sentence-detail" data-sdetail="${escAttr(t.id)}">
      <div class="sd-text">${esc(s.text)}</div>
      <div class="sd-src">${esc(srcLabel(e) || "출처 없음")} · ${esc(fmtDate(e.date))}</div>
      <div class="sd-section"><div class="sd-h">나의 해석 (이 필사 전체)</div><div class="sd-interp">${interp ? esc(interp) : "<i>아직 해석을 쓰지 않았습니다.</i>"}</div></div>
      <div class="sd-section"><div class="sd-h">Claude — 뜻 · 문법 · 더 나은 해석</div>${msgs}</div>
      <button class="sd-open" data-open-entry="${escAttr(e.id)}">이 필사 열기 →</button>
    </div>`;
  }

  /* ─────────────────────── 프로젝트 ─────────────────────── */
  let projectsState = { sort: "activity", filter: "", kind: "all" };
  function projectKey(e) {
    const a = (e.source && e.source.author || "").trim();
    const t = (e.source && e.source.title || "").trim();
    return a + "|" + t;
  }
  function getProjects() {
    const map = new Map();
    for (const e of state.entries) {
      const key = projectKey(e);
      let p = map.get(key);
      if (!p) {
        const [a, t] = key.split("|");
        p = { key, author: a, title: t, entries: [], lastUpdated: 0, transcriptionCount: 0, reflectionCount: 0 };
        map.set(key, p);
      }
      p.entries.push(e);
      const u = +new Date(e.updatedAt || e.createdAt || 0);
      if (u > p.lastUpdated) p.lastUpdated = u;
      if (e.kind === "reflection") p.reflectionCount++;
      else p.transcriptionCount++;
    }
    return Array.from(map.values());
  }
  function projectTitle(p) {
    if (p.author && p.title) return `${p.author} · ${p.title}`;
    return p.author || p.title || "출처 없음";
  }
  function humanAgo(ms) {
    if (!ms) return "";
    const now = Date.now();
    const diff = Math.max(0, now - ms);
    const day = 86400000;
    const days = Math.floor(diff / day);
    if (days <= 0) return "오늘";
    if (days === 1) return "어제";
    if (days === 2) return "그저께";
    if (days < 30) return `${days}일 전`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}개월 전`;
    const years = Math.floor(months / 12);
    return `${years}년 전`;
  }
  function projectExcerpt(p) {
    const ordered = [...p.entries].sort((a, b) =>
      (+new Date(b.updatedAt || b.createdAt || 0)) - (+new Date(a.updatedAt || a.createdAt || 0)));
    for (const e of ordered) {
      const t = e.kind === "reflection"
        ? (e.reflection && e.reflection.body)
        : e.body;
      if (t && t.trim()) return t.trim().slice(0, 220);
    }
    return "—";
  }
  function renderProjectsView() {
    D.projectsSort.value = projectsState.sort;
    D.projectsFilter.value = projectsState.filter || "";
    D.projectsKindFilter.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.kind === projectsState.kind));

    const f = (projectsState.filter || "").trim().toLowerCase();
    let list = getProjects();
    if (projectsState.kind === "transcription") list = list.filter((p) => p.transcriptionCount > 0);
    else if (projectsState.kind === "reflection") list = list.filter((p) => p.reflectionCount > 0);
    if (f) list = list.filter((p) => projectTitle(p).toLowerCase().includes(f) || projectExcerpt(p).toLowerCase().includes(f));
    if (projectsState.sort === "name") list.sort((a, b) => projectTitle(a).localeCompare(projectTitle(b), "ko"));
    else if (projectsState.sort === "count") list.sort((a, b) => b.entries.length - a.entries.length);
    else list.sort((a, b) => b.lastUpdated - a.lastUpdated);

    if (!list.length) {
      const msg = getProjects().length
        ? "이 분류에는 아직 프로젝트가 없습니다."
        : "아직 프로젝트가 없습니다.<br/>새 문서를 만들고 저자·작품을 적으면 자동으로 묶입니다.";
      D.projectsGrid.innerHTML = `<div class="projects-empty">${msg}</div>`;
      return;
    }
    D.projectsGrid.innerHTML = list.map((p) => {
      const slug = encodeURIComponent(p.key);
      const title = projectTitle(p);
      const desc = projectExcerpt(p);
      const total = p.entries.length;
      const ago = humanAgo(p.lastUpdated);
      return `<button type="button" class="project-card" data-project="${escAttr(slug)}">
        <div class="project-card-title-row">
          <span class="project-card-title">${esc(title)}</span>
        </div>
        <div class="project-card-desc">${esc(desc)}</div>
        <div class="project-card-foot">
          <span>${total}개</span>
          ${p.transcriptionCount ? `<span class="dot-sep">·</span><span>필사 ${p.transcriptionCount}</span>` : ""}
          ${p.reflectionCount ? `<span class="dot-sep">·</span><span>사유 ${p.reflectionCount}</span>` : ""}
          ${ago ? `<span class="dot-sep">·</span><span>${esc(ago)} 업데이트됨</span>` : ""}
        </div>
      </button>`;
    }).join("");
  }
  function renderProjectDetailView(slugRaw) {
    let key;
    try { key = decodeURIComponent(slugRaw || ""); } catch (_) { key = slugRaw || ""; }
    const all = getProjects();
    const p = all.find((x) => x.key === key);
    if (!p) {
      D.projectArtScroll.innerHTML = `<div class="art-empty">— 이 프로젝트가 없습니다. 엔트리가 모두 삭제되었거나 출처가 바뀌었습니다. —</div>`;
      return;
    }
    renderProjectArchive(p, D.projectArtScroll);
  }
  function renderProjectArchive(p, to) {
    const unpub = new Set(state.settings.unpublishedIds || []);
    const list = [...p.entries].sort((a, b) =>
      a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const title = projectTitle(p);
    const ago = humanAgo(p.lastUpdated);
    const meta = `${p.entries.length}개` +
      (p.transcriptionCount ? ` · 필사 ${p.transcriptionCount}` : "") +
      (p.reflectionCount ? ` · 사유 ${p.reflectionCount}` : "") +
      (ago ? ` · ${ago} 업데이트됨` : "");
    let html = `<div class="art-frontis">
      <div class="ft-mark">${esc(title)}</div>
      <div class="ft-en">${esc(meta)}</div>
      ${state.settings.curatorNote ? `<div class="ft-curator">${esc(state.settings.curatorNote)}</div>` : ""}
      <div class="ft-rule"></div>
    </div>`;
    if (!list.length) { html += `<div class="art-empty">— 아직 비어 있습니다 —</div>`; to.innerHTML = html; return; }
    list.forEach((e, idx) => {
      const isUn = unpub.has(e.id);
      const num = list.length <= 600 ? toRoman(idx + 1) : String(idx + 1);
      let body, interp = "", corr = "", threads = "";
      if (e.kind === "reflection") {
        const r = e.reflection || { body: "", revisions: [] };
        const text = (r.body || "").trim();
        body = text ? esc(text).replace(/\n/g, "<br/>") : "";
        // (in art mode we don't surface Claude's corrections — only the writer's own text)
      } else {
        body = buildArtBody(e);
        if (e.interpretation && e.interpretation.trim()) interp = `<div class="art-interp">${esc(e.interpretation)}</div>`;
        corr = (e.corrections || []).map((c) =>
          `<div class="art-correction"><span class="ts">${esc(fmtDate(c.timestamp))}</span><del>${esc(c.previousText) || "&nbsp;"}</del></div>`).join("");
        threads = (e.threads || []).filter((t) => t.anchorText && t.messages.some((m) => m.role === "assistant")).map((t) => {
          const a = t.messages.find((m) => m.role === "assistant" && !m.pending);
          return `<div class="art-thread"><span class="tri">△</span> <span class="q">${esc(t.anchorText)}</span>${a ? ` — <span class="a">${esc(a.content)}</span>` : ""}</div>`;
        }).join("");
      }
      const foot = `<div class="art-foot"><span class="fn-mark">—— </span>${esc([e.source.author, e.source.title].filter(Boolean).join(", "))}${e.source.page ? ", " + esc(pageRef(e.source.page)) : ""}${e.source.author || e.source.title ? ". " : ""}${esc(fmtDate(e.date))}${e.kind === "reflection" ? " · 사유" : ""}</div>`;
      html += `<section class="art-entry${isUn ? " is-unpublished" : ""}" data-art="${escAttr(e.id)}">
        <button class="art-pub-toggle" data-pub="${escAttr(e.id)}">${isUn ? "숨김 — 보이기" : "숨기기"}</button>
        <div class="art-entry-num">${esc(num)}${isUn ? " · 숨김" : ""}</div>
        <div class="art-text">${body || "<i style='opacity:.5'>(빈 본문)</i>"}</div>
        ${interp}
        ${corr ? `<div class="art-threads" style="margin-top:14px;">${corr}</div>` : ""}
        ${threads ? `<div class="art-threads">${threads}</div>` : ""}
        ${foot}
      </section>`;
    });
    to.innerHTML = html;
  }

  function openNewProjectModal() {
    const wrap = document.createElement("div");
    wrap.className = "new-project-form";
    wrap.innerHTML = `
      <div class="new-project-fields">
        <span class="new-project-label">저자</span>
        <input class="new-project-input" id="npAuthor" placeholder="예: 톨스토이" autocomplete="off" />
        <span class="new-project-label" style="margin-top:4px;">작품 · 주제</span>
        <input class="new-project-input" id="npTitle" placeholder="예: 예술이란 무엇인가" autocomplete="off" />
      </div>
      <div class="new-project-label" style="margin-top:6px;">첫 문서</div>
      <div class="new-project-pickers">
        <button type="button" class="doc-picker-card" data-kind="transcription">
          <span class="doc-picker-name">필사</span>
          <span class="doc-picker-desc">남의 글을 옮겨 적고 해석합니다.</span>
        </button>
        <button type="button" class="doc-picker-card" data-kind="reflection">
          <span class="doc-picker-name">사유</span>
          <span class="doc-picker-desc">내 생각을 직접 적고 다듬습니다.</span>
        </button>
      </div>`;
    wrap.addEventListener("click", (ev) => {
      const card = ev.target.closest(".doc-picker-card");
      if (!card) return;
      const author = (wrap.querySelector("#npAuthor").value || "").trim();
      const title = (wrap.querySelector("#npTitle").value || "").trim();
      if (!author && !title) {
        const a = wrap.querySelector("#npAuthor"); a.focus();
        a.style.borderColor = "var(--color-text-warning)";
        setTimeout(() => { a.style.borderColor = ""; }, 1200);
        return;
      }
      closeModal();
      newEntry(card.dataset.kind, { author, title });
    });
    openModal("새 프로젝트", wrap);
    setTimeout(() => { try { wrap.querySelector("#npAuthor").focus(); } catch (_) {} }, 0);
  }

  /* ─────────────────────── 나의 생각 (사유 archive) ─────────────────────── */
  let thoughtsState = { filter: "" };
  function reflectionEntriesSorted() {
    return state.entries
      .filter((e) => e.kind === "reflection")
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function renderThoughtsView() {
    const list = reflectionEntriesSorted();
    D.thoughtsSub.textContent = `${list.length}개의 사유 · 내가 적고 Claude가 다듬은 것들`;
    D.thoughtsFilter.value = thoughtsState.filter;
    const f = thoughtsState.filter.trim().toLowerCase();
    const filtered = !f ? list : list.filter((e) => {
      const r = e.reflection || {};
      const hay = [
        r.body || "",
        srcLabel(e) || "",
        ...(Array.isArray(r.revisions) ? r.revisions.flatMap((rv) => [rv.corrected || "", (rv.errors || []).map((er) => er.detail).join(" ")]) : []),
      ].join("\n").toLowerCase();
      return hay.includes(f);
    });
    if (!filtered.length) {
      D.thoughtList.innerHTML = `<div class="thought-row-empty">${list.length ? "거른 결과가 없습니다." : "아직 사유가 없습니다. 사이드바 “새 문서” → 사유로 시작합니다."}</div>`;
      return;
    }
    D.thoughtList.innerHTML = filtered.map((e) => {
      const r = e.reflection || { body: "", revisions: [] };
      const last = r.revisions && r.revisions.length ? r.revisions[r.revisions.length - 1] : null;
      const body = (r.body || "").trim();
      const src = srcLabel(e);
      const tagCounts = {};
      if (last && Array.isArray(last.errors)) for (const er of last.errors) tagCounts[er.tag] = (tagCounts[er.tag] || 0) + 1;
      const tagPills = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t, n]) => `<span class="reflect-err-tag">${esc(t)}·${n}</span>`).join(" ");
      const rev = r.revisions ? r.revisions.length : 0;
      return `<button type="button" class="thought-row" data-open-entry="${escAttr(e.id)}">
        <div class="thought-row-top">
          <div class="thought-row-date">${esc(fmtDate(e.date))}</div>
          <div class="thought-row-src">${esc(src || "—")}</div>
        </div>
        <div class="thought-row-body">${esc(body) || "<i style='opacity:.5'>(빈 본문)</i>"}</div>
        <div class="thought-row-tags">
          <span class="thought-row-revcount">${rev ? `교정 ${rev}회` : "아직 안 보냄"}</span>
          ${tagPills}
        </div>
      </button>`;
    }).join("");
  }

  /* ─────────────────────── SEARCH ─────────────────────── */
  let searchState = { q: "", colors: new Set(), claude: false, from: "", to: "", author: "", cursor: 0, results: [] };
  function openSearch() {
    D.searchScrim.hidden = false;
    D.searchInput.value = searchState.q;
    D.chipFrom.value = searchState.from; D.chipTo.value = searchState.to; D.chipAuthor.value = searchState.author;
    D.chipColor.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-on", searchState.colors.has(c.dataset.color)));
    D.chipClaude.classList.toggle("is-on", searchState.claude);
    runSearch();
    setTimeout(() => D.searchInput.focus(), 0);
  }
  function closeSearch() { D.searchScrim.hidden = true; }
  function snippet(text, q) {
    if (!q) return esc(text.slice(0, 160)) + (text.length > 160 ? "…" : "");
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(text.slice(0, 160)) + (text.length > 160 ? "…" : "");
    const a = Math.max(0, i - 40), b = Math.min(text.length, i + q.length + 80);
    return (a ? "…" : "") + esc(text.slice(a, i)) + "<b>" + esc(text.slice(i, i + q.length)) + "</b>" + esc(text.slice(i + q.length, b)) + (b < text.length ? "…" : "");
  }
  function runSearch() {
    const q = D.searchInput.value.trim();
    searchState.q = q;
    searchState.from = D.chipFrom.value; searchState.to = D.chipTo.value; searchState.author = D.chipAuthor.value.trim();
    const ql = q.toLowerCase();
    let res = state.entries.filter((e) => {
      if (e.kind === "reflection") return false; // 사유는 별도 아카이브에서 (step 7)
      if (searchState.from && e.date < searchState.from) return false;
      if (searchState.to && e.date > searchState.to) return false;
      if (searchState.author && !e.source.author.toLowerCase().includes(searchState.author.toLowerCase())) return false;
      if (searchState.colors.size && !e.highlights.some((h) => searchState.colors.has(h.type))) return false;
      if (searchState.claude && !e.threads.some((t) => t.messages.length)) return false;
      if (!q) return true;
      const hay = [e.body, e.interpretation, e.source.author, e.source.title, e.source.page]
        .concat(e.threads.flatMap((t) => [t.anchorText].concat(t.messages.map((m) => m.content)))).join("\n").toLowerCase();
      return hay.includes(ql);
    });
    res.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
    searchState.results = res; searchState.cursor = 0;
    renderSearchResults();
  }
  function renderSearchResults() {
    const q = searchState.q;
    if (!searchState.results.length) { D.searchResults.innerHTML = `<div class="sr-empty">결과가 없습니다.</div>`; return; }
    D.searchResults.innerHTML = searchState.results.map((e, i) => {
      let src = q ? null : null;
      let snip;
      if (q) {
        const ql = q.toLowerCase();
        const fields = [e.body, e.interpretation].concat(e.threads.flatMap((t) => t.messages.map((m) => m.content)));
        const hit = fields.find((f) => f.toLowerCase().includes(ql)) || e.body || e.interpretation || "";
        snip = snippet(hit, q);
      } else snip = snippet(e.body || e.interpretation || "", "");
      const colors = [...new Set(e.highlights.map((h) => h.type))].map((c) => `<span class="dot ${c === "yellow" ? "dot-y" : "dot-b"}" style="display:inline-block;width:7px;height:7px;border-radius:2px;"></span>`).join(" ");
      const hasC = e.threads.some((t) => t.messages.length) ? "△" : "";
      return `<button type="button" class="sr-item${i === searchState.cursor ? " is-cursor" : ""}" data-id="${escAttr(e.id)}">
        <div class="sr-meta"><span>${esc(fmtDate(e.date))}</span>${colors ? `<span>${colors}</span>` : ""}${hasC ? `<span>${hasC}</span>` : ""}</div>
        <div class="sr-src">${esc(srcLabel(e) || "제목 없음")}</div>
        <div class="sr-snippet">${snip}</div>
      </button>`;
    }).join("");
  }
  function searchMoveCursor(d) {
    if (!searchState.results.length) return;
    searchState.cursor = clamp(searchState.cursor + d, 0, searchState.results.length - 1);
    renderSearchResults();
    const el = D.searchResults.children[searchState.cursor];
    if (el) el.scrollIntoView({ block: "nearest" });
  }
  function searchOpenCursor() {
    const e = searchState.results[searchState.cursor];
    if (e) { closeSearch(); openEntry(e.id); }
  }

  /* ─────────────────────── ART MODE helpers (used by project archive) ─────────────────────── */
  function buildArtBody(e) {
    // same interleave as read-mode, marks render as thin underlines in art CSS
    return buildBodyHtml(e);
  }
  function editCuratorNote() {
    const ta = document.createElement("textarea");
    ta.value = state.settings.curatorNote || "";
    ta.placeholder = "공개 아카이브 앞에 둘 글 — 이 작업이 무엇인지, 왜 두 언어 사이에 있는지.";
    openModal("큐레이터 노트", ta, [
      { label: "취소" },
      { label: "저장", primary: true, onClick: () => {
          state.settings.curatorNote = ta.value; touchAppState();
          const { name, arg } = parseHash();
          if (name === "projects" && arg && arg.length) renderProjectDetailView(arg[0]);
        }
      },
    ]);
    setTimeout(() => ta.focus(), 0);
  }

  /* ─────────────────────── AUTH ─────────────────────── */
  let authMode = "signin"; // or "signup"
  function setAuthMode(m) {
    authMode = m;
    D.authSubmit.textContent = m === "signup" ? "회원가입" : "로그인";
    D.authSwitch.textContent = m === "signup" ? "이미 계정이 있으신가요? — 로그인" : "계정이 없으신가요? — 회원가입";
    D.authPassword.autocomplete = m === "signup" ? "new-password" : "current-password";
    D.authMsg.textContent = ""; D.authMsg.classList.remove("ok");
    D.authNote.textContent = m === "signup"
      ? "이 기록은 당신의 계정에만 보입니다. 같은 이메일·비밀번호로 다른 기기에서도 이어 쓸 수 있습니다."
      : "";
  }
  async function handleAuthSubmit(ev) {
    ev.preventDefault();
    const email = D.authEmail.value.trim(), pw = D.authPassword.value;
    if (!email || pw.length < 6) { D.authMsg.textContent = "이메일과 6자 이상의 비밀번호를 입력해 주세요."; return; }
    D.authSubmit.disabled = true; D.authMsg.textContent = "…"; D.authMsg.classList.remove("ok");
    try {
      if (authMode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password: pw });
        if (error) throw error;
        if (data.session) { D.authMsg.textContent = ""; }
        else { D.authMsg.textContent = "확인 메일을 보냈습니다. 메일의 링크로 인증을 마친 뒤 로그인해 주세요. (메일 인증이 꺼져 있다면 바로 로그인하세요.)"; D.authMsg.classList.add("ok"); setAuthMode("signin"); }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
    } catch (err) {
      const m = (err && err.message) || String(err);
      D.authMsg.textContent = /Invalid login/i.test(m) ? "이메일 또는 비밀번호가 올바르지 않습니다." : /already registered|already exists/i.test(m) ? "이미 가입된 이메일입니다 — 로그인해 주세요." : /Email not confirmed/i.test(m) ? "메일 인증이 아직 완료되지 않았습니다." : m;
    }
    D.authSubmit.disabled = false;
  }
  async function signOut() {
    await beaconFlush();
    try { localStorage.removeItem(cacheKey()); } catch (_) {}
    await sb.auth.signOut();
  }
  function showAuthScreen() {
    D.authView.hidden = false; D.app.hidden = true;
    setAuthMode("signin");
  }
  async function onAuthed(session) {
    user = { id: session.user.id, email: session.user.email };
    D.authView.hidden = true; D.app.hidden = false;
    D.wordmark.title = user.email || "";
    state = newVault();
    loadCache();
    rebuildTermIndex();
    renderRecentList(); renderSidebarCounts();
    renderRoute();
    applySidebar();
    await pullAll();
    renderRecentList(); renderSidebarCounts();
    // re-render whatever view is active
    renderRoute();
  }

  /* ─────────────────────── EXPORT / IMPORT ─────────────────────── */
  function exportJSON() {
    cacheLocal();
    const blob = new Blob([JSON.stringify({ pilsa: 1, exportedAt: nowISO(), ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pilsa-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${state.entries.length}개의 필사를 내보냈습니다`);
  }
  function importJSON(file) {
    if (!file) return;
    const r = new FileReader();
    r.onerror = () => toast("파일을 읽지 못했습니다");
    r.onload = () => {
      let parsed; try { parsed = JSON.parse(String(r.result)); } catch (_) { return toast("읽을 수 없는 파일입니다"); }
      if (!parsed || !Array.isArray(parsed.entries)) return toast("필사 백업 파일이 아닙니다");
      const n = parsed.entries.length;
      if (!confirm(`백업에서 ${n}개의 필사를 가져옵니다.\n현재 데이터(${state.entries.length}개)를 대체하고, 클라우드에도 덮어씁니다. 계속할까요?`)) return;
      const oldIds = new Set(state.entries.map((e) => e.id));
      state = normVault(parsed);
      rebuildTermIndex();
      const newIds = new Set(state.entries.map((e) => e.id));
      for (const id of oldIds) if (!newIds.has(id)) { deletedEntries.add(id); }
      // mark everything dirty so it syncs up
      for (const e of state.entries) dirtyEntries.add(e.id);
      dirtyAppState = true;
      currentId = (orderedEntries()[0] || {}).id || null;
      cacheLocal(); scheduleSync();
      renderRecentList(); renderSidebarCounts(); renderRoute();
      toast(`${n}개의 필사를 가져왔습니다`);
    };
    r.readAsText(file);
  }

  /* ─────────────────────── SIDEBAR / RESPONSIVE ─────────────────────── */
  let sidebarOpen = window.innerWidth > 820;
  function applySidebar() {
    const narrow = window.innerWidth <= 820;
    if (narrow) { D.app.classList.remove("sidebar-collapsed"); D.app.classList.toggle("sidebar-forced-open", sidebarOpen); D.sidebarReopen.hidden = sidebarOpen; }
    else { D.app.classList.remove("sidebar-forced-open"); D.app.classList.toggle("sidebar-collapsed", !sidebarOpen); D.sidebarReopen.hidden = sidebarOpen; }
  }
  function toggleSidebar() { sidebarOpen = !sidebarOpen; applySidebar(); }
  function autoCloseSidebarIfNarrow() { if (window.innerWidth <= 820 && sidebarOpen) { sidebarOpen = false; applySidebar(); } }

  /* ─────────────────────── WIRING ─────────────────────── */
  function wire() {
    // auth
    D.authForm.addEventListener("submit", handleAuthSubmit);
    D.authSwitch.addEventListener("click", () => setAuthMode(authMode === "signup" ? "signin" : "signup"));

    // sidebar nav
    D.newEntryBtn.addEventListener("click", newEntry);
    D.emptyNewBtn.addEventListener("click", newEntry);
    D.sidebarToggle.addEventListener("click", toggleSidebar);
    D.sidebarReopen.addEventListener("click", toggleSidebar);
    D.searchBtn.addEventListener("click", openSearch);
    D.wordsBtn.addEventListener("click", () => go("#words"));
    D.sentencesBtn.addEventListener("click", () => go("#sentences"));
    D.thoughtsBtn.addEventListener("click", () => go("#thoughts"));
    D.projectsBtn.addEventListener("click", () => go("#projects"));
    D.exportBtn.addEventListener("click", exportJSON);
    D.importBtn.addEventListener("click", () => D.importInput.click());
    D.importInput.addEventListener("change", () => { importJSON(D.importInput.files && D.importInput.files[0]); D.importInput.value = ""; });
    D.signOutBtn.addEventListener("click", () => { if (confirm("로그아웃할까요?")) signOut(); });
    D.recentList.addEventListener("click", (ev) => { const b = ev.target.closest(".recent-item"); if (b) openEntry(b.dataset.id); });

    // entry header
    D.deleteEntryBtn.addEventListener("click", deleteCurrentEntry);
    D.entryDate.addEventListener("change", () => {
      const e = currentEntry(); if (!e) return;
      const v = D.entryDate.value; if (!v) { D.entryDate.value = e.date; return; }
      e.date = v; D.entryWeekday.textContent = weekdayOf(v) ? "· " + weekdayOf(v) : "";
      touchEntry(e); renderRecentList();
    });
    const onSrc = (k, el) => { const e = currentEntry(); if (!e) return; e.source[k] = el.value; touchEntry(e); renderRecentList(); };
    D.srcAuthor.addEventListener("input", () => onSrc("author", D.srcAuthor));
    D.srcTitle.addEventListener("input", () => onSrc("title", D.srcTitle));
    D.srcPage.addEventListener("input", () => onSrc("page", D.srcPage));

    // reflection (사유) entry — header + body + mode + send
    D.reflectDeleteBtn.addEventListener("click", deleteCurrentEntry);
    D.reflectDate.addEventListener("change", () => {
      const e = currentEntry(); if (!e) return;
      const v = D.reflectDate.value; if (!v) { D.reflectDate.value = e.date; return; }
      e.date = v; D.reflectWeekday.textContent = weekdayOf(v) ? "· " + weekdayOf(v) : "";
      touchEntry(e); renderRecentList();
    });
    D.reflectAuthor.addEventListener("input", () => { const e = currentEntry(); if (!e) return; e.source.author = D.reflectAuthor.value; touchEntry(e); renderRecentList(); });
    D.reflectTitle.addEventListener("input", () => { const e = currentEntry(); if (!e) return; e.source.title = D.reflectTitle.value; touchEntry(e); renderRecentList(); });
    D.reflectBody.addEventListener("input", () => {
      const e = currentEntry(); if (!e || e.kind !== "reflection") return;
      if (!e.reflection) e.reflection = { mode: "correct", body: "", revisions: [] };
      e.reflection.body = D.reflectBody.value; touchEntry(e);
    });
    D.reflectBody.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); sendReflection(); }
    });
    D.reflectSend.addEventListener("click", () => sendReflection());
    D.reflectModes.addEventListener("click", (ev) => {
      const b = ev.target.closest(".reflect-mode"); if (!b || b.disabled) return;
      const e = currentEntry(); if (!e || e.kind !== "reflection") return;
      if (!e.reflection) e.reflection = { mode: "correct", body: "", revisions: [] };
      e.reflection.mode = b.dataset.mode || "correct";
      touchEntry(e);
      D.reflectModes.querySelectorAll(".reflect-mode").forEach((x) => x.classList.toggle("is-on", x === b));
      D.reflectModeDesc.textContent = modeDesc(e.reflection.mode);
    });

    // body: read mode
    D.bodyRender.addEventListener("click", (ev) => {
      const anchor = ev.target.closest(".thread-anchor");
      if (anchor) { ev.stopPropagation(); jumpToThread(anchor.dataset.thread); return; }
      // click to edit at offset
      let off = null;
      try {
        let pos = null;
        if (document.caretRangeFromPoint) pos = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(ev.clientX, ev.clientY); if (p) pos = { startContainer: p.offsetNode, startOffset: p.offset }; }
        if (pos && pos.startContainer) off = charOffsetIn(D.bodyRender, pos.startContainer, pos.startOffset);
      } catch (_) {}
      enterEdit(off);
    });
    D.bodyRender.addEventListener("mouseover", (ev) => {
      const t = ev.target.closest("[data-term],[data-note]");
      if (!t) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showWordTip(t), 130);
    });
    D.bodyRender.addEventListener("mouseout", (ev) => {
      const t = ev.target.closest("[data-term],[data-note]");
      if (t) hideWordTip();
    });
    D.main.addEventListener("scroll", hideWordTip);
    D.bodyRender.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); enterEdit(0); } });

    // body: edit mode
    D.bodyInput.addEventListener("input", onBodyInput);
    D.bodyInput.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== D.bodyInput) exitEdit(); }, 80));
    D.bodyInput.addEventListener("mousedown", () => { hideToolbar(); closeSlashMenu(); });
    D.bodyInput.addEventListener("mouseup", () => setTimeout(onBodySelChange, 0));
    D.bodyInput.addEventListener("keydown", (ev) => {
      if (!slashOpen) return;
      const list = filteredSlash();
      if (ev.key === "Escape") { ev.preventDefault(); closeSlashMenu(); return; }
      if (!list.length) {
        if (ev.key === "Enter" || ev.key === "Tab" || ev.key === "ArrowDown" || ev.key === "ArrowUp") closeSlashMenu();
        return;
      }
      if (ev.key === "ArrowDown") { ev.preventDefault(); slashIndex = (slashIndex + 1) % list.length; renderSlashMenu(); return; }
      if (ev.key === "ArrowUp")   { ev.preventDefault(); slashIndex = (slashIndex - 1 + list.length) % list.length; renderSlashMenu(); return; }
      if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); applySlash(list[slashIndex]); return; }
    });
    D.bodyInput.addEventListener("keyup", (ev) => {
      if (ev.shiftKey || /Arrow|Home|End/.test(ev.key) || ((ev.ctrlKey || ev.metaKey) && /^a$/i.test(ev.key))) onBodySelChange();
    });
    D.hlToolbar.addEventListener("mousedown", (ev) => ev.preventDefault());
    D.hlToolbar.querySelectorAll(".hl-btn").forEach((b) => b.addEventListener("click", () => applyHighlight(b.dataset.type)));

    // slash menu
    D.slashMenu.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep textarea focus & selection
    D.slashMenuList.addEventListener("mouseover", (ev) => {
      const it = ev.target.closest(".slash-item"); if (!it) return;
      const list = filteredSlash();
      const k = it.dataset.key; const idx = list.findIndex((b) => b.key === k);
      if (idx >= 0 && idx !== slashIndex) { slashIndex = idx; renderSlashMenu(); }
    });
    D.slashMenuList.addEventListener("click", (ev) => {
      const it = ev.target.closest(".slash-item"); if (!it) return;
      const tpl = SLASH_BLOCKS.find((b) => b.key === it.dataset.key);
      if (tpl) applySlash(tpl);
    });

    // interpretation
    D.interpInput.addEventListener("focus", () => { const e = currentEntry(); interpSnapshot = e ? e.interpretation : D.interpInput.value; });
    D.interpInput.addEventListener("input", () => { const e = currentEntry(); if (!e) return; e.interpretation = D.interpInput.value; autoGrow(D.interpInput); touchEntry(e); });
    D.interpInput.addEventListener("blur", captureInterpCorrection);
    D.interpInput.addEventListener("keydown", (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); sendInterpToClaude(); } });
    D.interpSend.addEventListener("click", sendInterpToClaude);
    D.interpRevisions.addEventListener("click", showRevisionsModal);

    // claude panel
    D.claudeHead.addEventListener("click", toggleClaudePanel);
    D.threadList.addEventListener("click", (ev) => {
      const del = ev.target.closest("[data-del]"); if (del) { ev.stopPropagation(); deleteThread(del.dataset.del); return; }
      const jump = ev.target.closest("[data-jump]"); if (jump) { jumpToThread(jump.dataset.jump); return; }
    });
    D.claudeInput.addEventListener("input", () => autoGrow(D.claudeInput, 160));
    D.claudeInput.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); sendCompose(); }
      else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); sendCompose(); }
    });
    D.claudeSend.addEventListener("click", sendCompose);

    // words view
    D.wordsSort.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-sort]"); if (b) { wordsState.sort = b.dataset.sort; renderWordsView(); } });
    D.wordsFilter.addEventListener("input", () => { wordsState.filter = D.wordsFilter.value; renderWordsView(); });
    D.wordsGrid.addEventListener("click", (ev) => {
      const openEntryBtn = ev.target.closest("[data-open-entry]"); if (openEntryBtn) { go("#daily"); openEntry(openEntryBtn.dataset.openEntry); return; }
      const card = ev.target.closest(".word-card"); if (card) { wordsState.open = wordsState.open === card.dataset.word ? null : card.dataset.word; renderWordsView(); return; }
      const detail = ev.target.closest(".word-detail"); if (!detail) return;
      const term = state.terms.find((t) => t.id === detail.dataset.detail); if (!term) return;
      const defdel = ev.target.closest("[data-defdel]"); if (defdel) { term.definitions.splice(+defdel.dataset.defdel, 1); touchAppState(); renderWordsView(); return; }
      const defbtn = ev.target.closest("[data-defadd-btn]"); if (defbtn) { const inp = detail.querySelector("[data-defadd]"); const v = inp.value.trim(); if (v) { term.definitions.push(v); touchAppState(); renderWordsView(); } return; }
    });
    D.wordsGrid.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target.matches("[data-defadd]")) { ev.preventDefault(); const detail = ev.target.closest(".word-detail"); const term = state.terms.find((t) => t.id === detail.dataset.detail); const v = ev.target.value.trim(); if (term && v) { term.definitions.push(v); touchAppState(); renderWordsView(); } }
    });

    // sentences view
    D.sentencesFilter.addEventListener("input", () => { sentencesState.filter = D.sentencesFilter.value; renderSentencesView(); });
    D.thoughtsFilter.addEventListener("input", () => { thoughtsState.filter = D.thoughtsFilter.value; renderThoughtsView(); });
    D.thoughtList.addEventListener("click", (ev) => {
      const row = ev.target.closest("[data-open-entry]");
      if (row) { go("#daily"); openEntry(row.dataset.openEntry); }
    });

    // projects — grid
    D.projectsFilter.addEventListener("input", () => { projectsState.filter = D.projectsFilter.value; renderProjectsView(); });
    D.projectsSort.addEventListener("change", () => { projectsState.sort = D.projectsSort.value; renderProjectsView(); });
    D.projectsKindFilter.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-kind]"); if (!b) return;
      projectsState.kind = b.dataset.kind;
      renderProjectsView();
    });
    D.projectsNewBtn.addEventListener("click", openNewProjectModal);
    D.projectsGrid.addEventListener("click", (ev) => {
      const card = ev.target.closest(".project-card");
      if (card) go("#projects/" + card.dataset.project);
    });
    // projects — detail
    D.projectBackBtn.addEventListener("click", () => go("#projects"));
    D.sentenceList.addEventListener("click", (ev) => {
      const openEntryBtn = ev.target.closest("[data-open-entry]"); if (openEntryBtn) { go("#daily"); openEntry(openEntryBtn.dataset.openEntry); return; }
      const row = ev.target.closest(".sentence-row"); if (row) { sentencesState.open = sentencesState.open === row.dataset.sentence ? null : row.dataset.sentence; renderSentencesView(); }
    });

    // project detail (art-style archive of one project)
    D.projectCuratorEditBtn.addEventListener("click", editCuratorNote);
    D.projectArtScroll.addEventListener("click", (ev) => {
      const pub = ev.target.closest("[data-pub]");
      if (pub) {
        ev.stopPropagation();
        const id = pub.dataset.pub;
        const set = new Set(state.settings.unpublishedIds || []);
        if (set.has(id)) set.delete(id); else set.add(id);
        state.settings.unpublishedIds = [...set];
        touchAppState();
        const { arg } = parseHash();
        if (arg && arg.length) renderProjectDetailView(arg[0]);
        return;
      }
      const anchor = ev.target.closest(".thread-anchor");
      if (anchor) {
        const sec = anchor.closest(".art-entry");
        if (sec) { go("#daily"); openEntry(sec.dataset.art); openClaudePanel(true); }
      }
    });

    // search modal
    D.searchClose.addEventListener("click", closeSearch);
    D.searchScrim.addEventListener("mousedown", (ev) => { if (ev.target === D.searchScrim) closeSearch(); });
    D.searchInput.addEventListener("input", debounce(runSearch, 120));
    D.chipColor.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { const k = c.dataset.color; if (searchState.colors.has(k)) searchState.colors.delete(k); else searchState.colors.add(k); c.classList.toggle("is-on"); runSearch(); }));
    D.chipClaude.addEventListener("click", () => { searchState.claude = !searchState.claude; D.chipClaude.classList.toggle("is-on", searchState.claude); runSearch(); });
    [D.chipFrom, D.chipTo].forEach((el) => el.addEventListener("change", runSearch));
    D.chipAuthor.addEventListener("input", debounce(runSearch, 150));
    D.searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); searchMoveCursor(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); searchMoveCursor(-1); }
      else if (ev.key === "Enter") { ev.preventDefault(); searchOpenCursor(); }
      else if (ev.key === "Escape") closeSearch();
    });
    D.searchResults.addEventListener("click", (ev) => { const it = ev.target.closest(".sr-item"); if (it) { closeSearch(); openEntry(it.dataset.id); } });

    // generic modal
    D.modalClose.addEventListener("click", closeModal);
    D.modalScrim.addEventListener("mousedown", (ev) => { if (ev.target === D.modalScrim) closeModal(); });

    // global
    document.addEventListener("mousedown", (ev) => {
      if (!D.hlToolbar.hidden && !D.bodyField.contains(ev.target)) hideToolbar();
      if (slashOpen && !D.slashMenu.contains(ev.target) && ev.target !== D.bodyInput) closeSlashMenu();
    }, true);
    document.addEventListener("keydown", (ev) => {
      if (!user) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && /^k$/i.test(ev.key)) { ev.preventDefault(); D.searchScrim.hidden ? openSearch() : closeSearch(); return; }
      if (mod && /^n$/i.test(ev.key)) { ev.preventDefault(); newEntry(); return; }
      if (mod && /^s$/i.test(ev.key)) { ev.preventDefault(); flushSyncNow(); flashStatus("저장됨"); return; }
      if (mod && (ev.key === "1" || ev.key === "2") && editing && pendingSel) { ev.preventDefault(); applyHighlight(ev.key === "1" ? "yellow" : "blue"); return; }
      if (ev.key === "Escape") { if (!D.modalScrim.hidden) closeModal(); else if (!D.searchScrim.hidden) closeSearch(); else { closeSlashMenu(); hideToolbar(); } hideWordTip(); }
    });
    window.addEventListener("resize", () => { applySidebar(); if (!D.entryView.hidden) autoGrow(D.interpInput); autoGrow(D.claudeInput, 160); hideToolbar(); hideWordTip(); });
    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("online", () => { online = true; setSync("ok"); flushSyncNow(); });
    window.addEventListener("offline", () => { online = false; setSync("offline"); });
    window.addEventListener("pagehide", () => { captureInterpCorrection(); beaconFlush(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { captureInterpCorrection(); beaconFlush(); } });

    // auth state
    sb.auth.onAuthStateChange((event, session) => {
      if (session && session.user) { if (!user || user.id !== session.user.id) onAuthed(session); }
      else { user = null; showAuthScreen(); }
    });
  }

  /* helper: char offset of (node, offset) within `root`'s plain text (ignoring empty thread-anchor sups) */
  function charOffsetIn(root, node, offset) {
    let target = node, stopBefore = null;
    if (!node || node.nodeType !== 3) { stopBefore = (node && node.childNodes[offset]) || null; target = null; }
    let acc = 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) {
      const inAnchor = n.parentElement && n.parentElement.closest(".thread-anchor");
      if (target) {
        if (n === target) return acc + Math.min(offset, n.nodeValue.length);
        if (!inAnchor) acc += n.nodeValue.length;
      } else {
        if (stopBefore && (n === stopBefore || (stopBefore.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING))) break;
        if (!inAnchor) acc += n.nodeValue.length;
      }
    }
    return acc;
  }

  /* ─────────────────────── INIT ─────────────────────── */
  async function init() {
    bindRefs();
    wire();
    applySidebar();
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session && data.session.user) { if (!user) onAuthed(data.session); }
      else if (!user) showAuthScreen();
    } catch (_) { if (!user) showAuthScreen(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
