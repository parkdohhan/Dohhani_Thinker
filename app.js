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

  function blankEntry() {
    const t = nowISO();
    return {
      id: uid(), date: todayISO(),
      source: { author: "", title: "", page: "" },
      body: "", highlights: [], interpretation: "", corrections: [], threads: [],
      createdAt: t, updatedAt: t,
    };
  }
  function normEntry(e) {
    e = e && typeof e === "object" ? e : {};
    const s = e.source && typeof e.source === "object" ? e.source : {};
    return {
      id: typeof e.id === "string" ? e.id : uid(),
      date: typeof e.date === "string" && e.date ? e.date.slice(0, 10) : todayISO(),
      source: { author: s.author || "", title: s.title || "", page: s.page || "" },
      body: typeof e.body === "string" ? e.body : "",
      highlights: Array.isArray(e.highlights) ? e.highlights.filter((h) => h && h.endChar > h.startChar).map((h) => ({
        id: h.id || uid(), startChar: h.startChar | 0, endChar: h.endChar | 0,
        type: h.type === "blue" ? "blue" : "yellow", note: h.note || "",
      })) : [],
      interpretation: typeof e.interpretation === "string" ? e.interpretation : "",
      corrections: Array.isArray(e.corrections) ? e.corrections.filter((c) => c && typeof c === "object").map((c) => ({
        timestamp: c.timestamp || nowISO(), previousText: c.previousText || "", newText: c.newText || "",
      })) : [],
      threads: Array.isArray(e.threads) ? e.threads.map(normThread) : (Array.isArray(e.messages) ? migrateMessages(e.messages) : []),
      createdAt: e.createdAt || nowISO(), updatedAt: e.updatedAt || e.createdAt || nowISO(),
    };
  }
  function normThread(t) {
    t = t && typeof t === "object" ? t : {};
    return {
      id: t.id || uid(),
      anchorChar: Number.isFinite(t.anchorChar) ? t.anchorChar | 0 : null,
      anchorText: t.anchorText || "",
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
    for (const e of state.entries) for (const th of e.threads) {
      if (normWord(th.anchorText) === word) for (const m of th.messages) if (m.role === "assistant") out.push({ entry: e, thread: th, msg: m });
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
    return { id: e.id, user_id: user.id, entry_date: e.date, updated_at: e.updatedAt, created_at: e.createdAt,
      data: { source: e.source, body: e.body, highlights: e.highlights, interpretation: e.interpretation, corrections: e.corrections, threads: e.threads } };
  }
  function rowToEntry(r) {
    const d = r.data || {};
    return normEntry({ id: r.id, date: r.entry_date, source: d.source, body: d.body, highlights: d.highlights,
      interpretation: d.interpretation, corrections: d.corrections, threads: d.threads, messages: d.messages,
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
      "app","sidebar","sidebarToggle","wordmark","syncDot","newEntryBtn","searchBtn","wordsBtn","sentencesBtn","artBtn",
      "wordsCount","sentencesCount","recentList","exportBtn","importBtn","signOutBtn","importInput","sidebarReopen","main",
      "emptyState","emptyNewBtn","entryView","entryDate","entryWeekday","entryStatus","deleteEntryBtn","srcAuthor","srcTitle","srcPage",
      "bodyField","bodyRender","bodyEditWrap","bodyBackdrop","bodyInput","hlToolbar","bodyHint","interpInput","interpRevisions",
      "claudePanel","claudeHead","claudeTitle","claudeChevron","claudeBody","threadList","claudeCompose","claudeInput","claudeSend","claudeWarn",
      "wordsView","wordsSub","wordsFilter","wordsSort","wordsGrid","sentencesView","sentencesSub","sentencesFilter","sentenceList",
      "artView","artToolbar","artCuratorEditBtn","artExitBtn","artScroll",
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
    [D.emptyState, D.entryView, D.wordsView, D.sentencesView, D.artView].forEach((v) => (v.hidden = true));
    D.searchScrim.hidden = true;
    [D.searchBtn, D.wordsBtn, D.sentencesBtn, D.artBtn].forEach((b) => b.classList.remove("is-on"));
    if (name === "words") { D.wordsBtn.classList.add("is-on"); D.wordsView.hidden = false; renderWordsView(); }
    else if (name === "sentences") { D.sentencesBtn.classList.add("is-on"); D.sentencesView.hidden = false; renderSentencesView(); }
    else if (name === "art") { D.artBtn.classList.add("is-on"); D.artView.hidden = false; renderArtView(); }
    else { showDaily(); }
    if (name !== "daily" && name !== "") D.main.scrollTop = 0;
  }
  function showDaily() {
    D.main.scrollTop = 0;
    if (!state.entries.length) { D.emptyState.hidden = false; D.entryView.hidden = true; return; }
    if (!currentEntry()) {
      let openId = null;
      try { openId = localStorage.getItem(lastOpenKey()); } catch (_) {}
      currentId = openId && findEntry(openId) ? openId : (orderedEntries()[0] || {}).id || null;
    }
    if (!currentEntry()) { D.emptyState.hidden = false; return; }
    D.emptyState.hidden = true; D.entryView.hidden = false;
    renderEntry();
  }

  /* ─────────────────────── DAILY: ENTRY ─────────────────────── */
  function rememberOpen() { try { if (currentId) localStorage.setItem(lastOpenKey(), currentId); } catch (_) {} }

  function newEntry() {
    captureInterpCorrection();
    const e = blankEntry();
    state.entries.push(e);
    currentId = e.id; activeThreadId = null;
    touchEntry(e); rememberOpen();
    if (parseHash().name !== "daily") location.hash = "#daily";
    else { showDaily(); renderRecentList(); }
    autoCloseSidebarIfNarrow();
    D.srcAuthor.focus();
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
    const label = srcLabel(e) || e.date;
    if (!confirm(`이 필사를 삭제할까요?\n\n${label}\n\n되돌릴 수 없습니다.`)) return;
    state.entries = state.entries.filter((x) => x.id !== e.id);
    deletedEntries.add(e.id); dirtyEntries.delete(e.id);
    pruneEntryFromTerms(e.id);
    const nx = orderedEntries()[0];
    currentId = nx ? nx.id : null;
    scheduleSync(); cacheLocal();
    renderRecentList(); showDaily(); renderSidebarCounts();
    toast("필사를 삭제했습니다");
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

  /* ── body: read-mode rendering ── */
  function buildEvents(e) {
    const len = e.body.length;
    const hls = [...e.highlights].map((h) => ({ ...h, startChar: clamp(h.startChar, 0, len), endChar: clamp(h.endChar, 0, len) }))
      .filter((h) => h.endChar > h.startChar).sort((a, b) => a.startChar - b.startChar);
    // drop overlaps
    const clean = []; let last = -1;
    for (const h of hls) { if (h.startChar >= last) { clean.push(h); last = h.endChar; } }
    const ev = [];
    for (const h of clean) {
      ev.push({ pos: h.startChar, k: 2, hl: h });
      ev.push({ pos: h.endChar, k: 0, hl: h });
    }
    for (const t of e.threads) {
      if (Number.isFinite(t.anchorChar)) ev.push({ pos: clamp(t.anchorChar, 0, len), k: 1, thread: t });
    }
    ev.sort((a, b) => a.pos - b.pos || a.k - b.k);
    return ev;
  }
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
  function buildBodyHtml(e, opts) {
    opts = opts || {};
    const text = e.body;
    if (!text) return "";
    const ev = buildEvents(e);
    let html = "", cur = 0, inHl = null;
    for (const x of ev) {
      const seg = text.slice(cur, x.pos);
      html += inHl ? esc(seg) : termWrap(seg);
      cur = x.pos;
      if (x.k === 2) { inHl = x.hl; html += `<mark${markAttrs(x.hl, e)}>`; }
      else if (x.k === 0) { html += "</mark>"; inHl = null; }
      else if (x.k === 1) { html += `<sup class="thread-anchor" data-thread="${escAttr(x.thread.id)}" title="Claude 대화"></sup>`; }
    }
    const tail = text.slice(cur);
    html += inHl ? esc(tail) : termWrap(tail);
    if (inHl) html += "</mark>";
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
    hideToolbar();
    renderBackdrop();
    touchEntry(e);
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
    e.highlights = e.highlights.filter((h) => h.endChar <= sel.s || h.startChar >= sel.e);
    if (type !== "clear") {
      const hl = { id: uid(), startChar: sel.s, endChar: sel.e, type, note: "" };
      e.highlights.push(hl);
      if (type === "yellow") upsertEncounter(e, hl);
    }
    touchEntry(e);
    renderBackdrop();
    hideToolbar();
    try { D.bodyInput.focus(); D.bodyInput.setSelectionRange(sel.e, sel.e); } catch (_) {}
    flashStatus(type === "clear" ? "표시 지움" : "표시됨");
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
        : `<div class="thread-anchor-quote" data-jump="${escAttr(t.id)}"><span class="q" style="font-family:var(--font-sans);font-style:normal;color:var(--color-text-tertiary);">이 필사에 대한 일반 질문</span><button class="thread-del" data-del="${escAttr(t.id)}">삭제</button></div>`;
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
  async function sendCompose() {
    const e = currentEntry(); if (!e) return;
    const text = D.claudeInput.value.trim();
    if (!text) return;
    let th = activeThreadId ? e.threads.find((x) => x.id === activeThreadId) : null;
    if (!th) { th = { id: uid(), anchorChar: null, anchorText: "", createdAt: nowISO(), updatedAt: nowISO(), messages: [] }; e.threads.push(th); activeThreadId = th.id; }
    D.claudeInput.value = ""; autoGrow(D.claudeInput, 160);
    D.claudeWarn.hidden = true;
    await runClaude(th, text);
  }
  async function runClaude(th, userText) {
    const e = currentEntry(); if (!e) return;
    th.messages.push({ id: uid(), role: "user", content: userText, timestamp: nowISO() });
    const pending = { id: uid(), role: "assistant", content: "", pending: true, timestamp: nowISO() };
    th.messages.push(pending);
    th.updatedAt = nowISO();
    touchEntry(e);
    openClaudePanel(true);
    renderThreads();
    setComposeAnchor(th.anchorText ? th : null);
    D.claudeSend.disabled = true;
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const turns = th.messages.filter((m) => !m.pending && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));
      const context = { author: e.source.author, title: e.source.title, page: e.source.page, body: e.body, interpretation: e.interpretation, selection: th.anchorText || null };
      const resp = await fetch(CLAUDE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ messages: turns, context }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || out.error) throw new Error((out && out.error) ? out.error : `요청 실패 (${resp.status})`);
      pending.pending = false; pending.content = out.text || "(빈 응답)";
      delete pending.pending;
    } catch (err) {
      th.messages = th.messages.filter((m) => m.id !== pending.id);
      showClaudeWarn("Claude 호출 실패 — " + (err.message || String(err)));
    }
    D.claudeSend.disabled = false;
    th.updatedAt = nowISO();
    touchEntry(e);
    renderThreads();
    const el = D.threadList.querySelector(`.thread[data-thread="${cssEsc(th.id)}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    let sc = 0;
    for (const e of state.entries) for (const t of e.threads) if (t.anchorText && t.messages.length) sc++;
    D.sentencesCount.textContent = sc ? String(sc) : "";
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
    for (const e of state.entries) for (const t of e.threads) {
      if (!t.anchorText || !t.messages.length) continue;
      out.push({ entry: e, thread: t, text: t.anchorText, date: e.date, createdAt: t.createdAt });
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

  /* ─────────────────────── ART MODE (Cha-style) ─────────────────────── */
  function renderArtView() {
    const list = entriesChrono();
    const to = D.artScroll;
    const unpub = new Set(state.settings.unpublishedIds || []);
    const epigraph = `필사 — 한 사람이 두 언어 사이를 건너며 남긴 자취.\nthe transcribed body, kept as evidence.`;
    let html = `<div class="art-frontis">
      <div class="ft-mark">필사</div>
      <div class="ft-en">${esc(epigraph)}</div>
      ${state.settings.curatorNote ? `<div class="ft-curator">${esc(state.settings.curatorNote)}</div>` : ""}
      <div class="ft-rule"></div>
    </div>`;
    if (!list.length) { html += `<div class="art-empty">— 아직 비어 있습니다 —</div>`; to.innerHTML = html; return; }
    list.forEach((e, idx) => {
      const isUn = unpub.has(e.id);
      const num = list.length <= 600 ? toRoman(idx + 1) : String(idx + 1);
      const bodyHtml = buildArtBody(e);
      const corr = (e.corrections || []).map((c) =>
        `<div class="art-correction"><span class="ts">${esc(fmtDate(c.timestamp))}</span><del>${esc(c.previousText) || "&nbsp;"}</del></div>`).join("");
      const threads = (e.threads || []).filter((t) => t.anchorText && t.messages.some((m) => m.role === "assistant")).map((t) => {
        const a = t.messages.find((m) => m.role === "assistant" && !m.pending);
        return `<div class="art-thread"><span class="tri">△</span> <span class="q">${esc(t.anchorText)}</span>${a ? ` — <span class="a">${esc(a.content)}</span>` : ""}</div>`;
      }).join("");
      const foot = `<div class="art-foot"><span class="fn-mark">—— </span>${esc([e.source.author, e.source.title].filter(Boolean).join(", "))}${e.source.page ? ", " + esc(pageRef(e.source.page)) : ""}${e.source.author || e.source.title ? ". " : ""}${esc(fmtDate(e.date))}</div>`;
      html += `<section class="art-entry${isUn ? " is-unpublished" : ""}" data-art="${escAttr(e.id)}">
        <button class="art-pub-toggle" data-pub="${escAttr(e.id)}">${isUn ? "숨김 — 보이기" : "숨기기"}</button>
        <div class="art-entry-num">${esc(num)}${isUn ? " · 숨김" : ""}</div>
        <div class="art-text">${bodyHtml || "<i style='opacity:.5'>(빈 본문)</i>"}</div>
        ${e.interpretation.trim() ? `<div class="art-interp">${esc(e.interpretation)}</div>` : ""}
        ${corr ? `<div class="art-threads" style="margin-top:14px;">${corr}</div>` : ""}
        ${threads ? `<div class="art-threads">${threads}</div>` : ""}
        ${foot}
      </section>`;
    });
    to.innerHTML = html;
  }
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
      { label: "저장", primary: true, onClick: () => { state.settings.curatorNote = ta.value; touchAppState(); renderArtView(); } },
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
    D.artBtn.addEventListener("click", () => go("#art"));
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
    D.bodyInput.addEventListener("mousedown", hideToolbar);
    D.bodyInput.addEventListener("mouseup", () => setTimeout(onBodySelChange, 0));
    D.bodyInput.addEventListener("keyup", (ev) => {
      if (ev.shiftKey || /Arrow|Home|End/.test(ev.key) || ((ev.ctrlKey || ev.metaKey) && /^a$/i.test(ev.key))) onBodySelChange();
    });
    D.hlToolbar.addEventListener("mousedown", (ev) => ev.preventDefault());
    D.hlToolbar.querySelectorAll(".hl-btn").forEach((b) => b.addEventListener("click", () => applyHighlight(b.dataset.type)));

    // interpretation
    D.interpInput.addEventListener("focus", () => { const e = currentEntry(); interpSnapshot = e ? e.interpretation : D.interpInput.value; });
    D.interpInput.addEventListener("input", () => { const e = currentEntry(); if (!e) return; e.interpretation = D.interpInput.value; autoGrow(D.interpInput); touchEntry(e); });
    D.interpInput.addEventListener("blur", captureInterpCorrection);
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
    D.sentenceList.addEventListener("click", (ev) => {
      const openEntryBtn = ev.target.closest("[data-open-entry]"); if (openEntryBtn) { go("#daily"); openEntry(openEntryBtn.dataset.openEntry); return; }
      const row = ev.target.closest(".sentence-row"); if (row) { sentencesState.open = sentencesState.open === row.dataset.sentence ? null : row.dataset.sentence; renderSentencesView(); }
    });

    // art view
    D.artExitBtn.addEventListener("click", () => go("#daily"));
    D.artCuratorEditBtn.addEventListener("click", editCuratorNote);
    D.artScroll.addEventListener("click", (ev) => {
      const pub = ev.target.closest("[data-pub]");
      if (pub) {
        ev.stopPropagation();
        const id = pub.dataset.pub;
        const set = new Set(state.settings.unpublishedIds || []);
        if (set.has(id)) set.delete(id); else set.add(id);
        state.settings.unpublishedIds = [...set];
        touchAppState(); renderArtView();
        return;
      }
      const anchor = ev.target.closest(".thread-anchor");
      if (anchor) { /* in art mode, jumping opens the entry */ const sec = anchor.closest(".art-entry"); if (sec) { go("#daily"); openEntry(sec.dataset.art); openClaudePanel(true); } }
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
    document.addEventListener("mousedown", (ev) => { if (!D.hlToolbar.hidden && !D.bodyField.contains(ev.target)) hideToolbar(); }, true);
    document.addEventListener("keydown", (ev) => {
      if (!user) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && /^k$/i.test(ev.key)) { ev.preventDefault(); D.searchScrim.hidden ? openSearch() : closeSearch(); return; }
      if (mod && /^n$/i.test(ev.key)) { ev.preventDefault(); newEntry(); return; }
      if (mod && /^s$/i.test(ev.key)) { ev.preventDefault(); flushSyncNow(); flashStatus("저장됨"); return; }
      if (mod && (ev.key === "1" || ev.key === "2") && editing && pendingSel) { ev.preventDefault(); applyHighlight(ev.key === "1" ? "yellow" : "blue"); return; }
      if (ev.key === "Escape") { if (!D.modalScrim.hidden) closeModal(); else if (!D.searchScrim.hidden) closeSearch(); else hideToolbar(); hideWordTip(); }
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
