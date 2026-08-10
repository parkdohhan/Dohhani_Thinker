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
      document.body.innerHTML = '<div style="max-width:420px;margin:14vh auto;padding:0 20px;font-family:sans-serif;color:#5b574e;text-align:center;line-height:1.8;">'
        + '<b>로그인 모듈을 불러오지 못했습니다.</b><br/><br/>'
        + '광고 차단기·회사 네트워크·VPN이 <code>cdn.jsdelivr.net</code> 과 <code>unpkg.com</code> 을 막고 있을 수 있습니다.<br/>'
        + '차단을 잠시 끄거나 다른 네트워크(휴대폰 데이터 등)에서 새로고침해 주세요.'
        + '</div>';
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
  let currentPassageId = null; // active passage in the open transcription entry
  let activeThreadId = null; // thread receiving compose messages
  let editing = false; // body edit mode
  // > 0 while ANY AI request is in flight. pullAll must not swap state.entries
  // out from under an in-flight call, or the response lands on an orphaned object.
  let aiBusy = 0;
  let online = navigator.onLine;
  const dirtyEntries = new Set();
  const deletedEntries = new Set();
  let dirtyAppState = false;

  function newVault() { return { entries: [], terms: [], patterns: [], settings: { artAesthetic: "cha", curatorNote: "", unpublishedIds: [], kitsTaken: [], tourSeenAt: "" } }; }

  /* 역번역 (reverse translation) — the four categories a diff can fall into */
  const REV_CATEGORIES = ["lexis-register", "connectives", "structure", "articles-prepositions"];
  const REV_CAT_LABEL = {
    "lexis-register": "어휘·격",
    "connectives": "연결",
    "structure": "구조",
    "articles-prepositions": "관사·전치사",
  };
  const REV_STAGES = ["new", "d3", "d14", "done"];
  const REV_STAGE_LABEL = { new: "1차", d3: "3일", d14: "2주", done: "완료" };
  const kindOf = (k) => (k === "reflection" || k === "reverse" || k === "speech" ? k : "transcription");
  const kindLabelOf = (k) => (k === "reflection" ? "사유" : k === "reverse" ? "역번역" : k === "speech" ? "발표" : "필사");
  function plusDaysISO(days) {
    const d = new Date(todayISO() + "T00:00:00");
    d.setDate(d.getDate() + days);
    const z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function blankEntry(kind) {
    kind = kindOf(kind);
    const t = nowISO();
    const base = {
      id: uid(), date: todayISO(),
      kind,
      source: { author: "", title: "", page: "" },
      createdAt: t, updatedAt: t,
    };
    if (kind === "reflection") {
      base.reflection = { mode: "correct", blocks: [{ id: uid(), kind: "user", text: "" }] };
    } else if (kind === "reverse") {
      base.reverse = { passages: [blankRevPassage()] };
    } else if (kind === "speech") {
      base.speech = normSpeech({});
    } else {
      const p0 = blankPassage();
      base.passages = [p0];
      // top-level mirrors the active passage (first by default)
      base.body = p0.body; base.highlights = p0.highlights; base.interpretation = p0.interpretation;
      base.corrections = p0.corrections; base.threads = p0.threads;
    }
    return base;
  }
  function blankPassage() {
    return { id: uid(), body: "", highlights: [], interpretation: "", corrections: [], threads: [] };
  }
  function normPassage(p) {
    p = p && typeof p === "object" ? p : {};
    return {
      id: typeof p.id === "string" ? p.id : uid(),
      body: typeof p.body === "string" ? p.body : "",
      highlights: Array.isArray(p.highlights) ? p.highlights.filter((h) => h && h.endChar > h.startChar).map((h) => ({
        id: h.id || uid(), startChar: h.startChar | 0, endChar: h.endChar | 0,
        type: h.type === "blue" ? "blue" : "yellow", note: h.note || "",
      })) : [],
      interpretation: typeof p.interpretation === "string" ? p.interpretation : "",
      corrections: Array.isArray(p.corrections) ? p.corrections.filter((c) => c && typeof c === "object").map((c) => ({
        timestamp: c.timestamp || nowISO(), previousText: c.previousText || "", newText: c.newText || "",
      })) : [],
      threads: Array.isArray(p.threads) ? p.threads.map(normThread)
              : (Array.isArray(p.messages) ? migrateMessages(p.messages) : []),
    };
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
  function normReflectBlock(b) {
    b = b && typeof b === "object" ? b : {};
    if (b.kind === "ai") {
      return {
        id: typeof b.id === "string" ? b.id : uid(), kind: "ai",
        mode: b.mode === "expand" || b.mode === "deep" ? b.mode : "correct",
        input: typeof b.input === "string" ? b.input : "",
        corrected: typeof b.corrected === "string" ? b.corrected : "",
        errors: Array.isArray(b.errors) ? b.errors
          .filter((x) => x && typeof x === "object")
          .map((x) => ({ tag: typeof x.tag === "string" ? x.tag : "grammar/other", detail: typeof x.detail === "string" ? x.detail : "" })) : [],
        expressions: Array.isArray(b.expressions) ? b.expressions.filter((x) => typeof x === "string") : [],
        summary: typeof b.summary === "string" ? b.summary : "",
        questions: Array.isArray(b.questions) ? b.questions.filter((x) => typeof x === "string") : [],
        timestamp: b.timestamp || nowISO(),
      };
    }
    return { id: typeof b.id === "string" ? b.id : uid(), kind: "user", text: typeof b.text === "string" ? b.text : "" };
  }
  function normReflection(r) {
    r = r && typeof r === "object" ? r : {};
    const mode = r.mode === "expand" || r.mode === "deep" ? r.mode : "correct";
    let blocks;
    if (Array.isArray(r.blocks) && r.blocks.length) {
      blocks = r.blocks.map(normReflectBlock);
    } else {
      // legacy: body + revisions → blocks
      blocks = [];
      for (const rev of (Array.isArray(r.revisions) ? r.revisions : [])) {
        const nr = normRevision(rev);
        blocks.push({ id: uid(), kind: "user", text: nr.input });
        blocks.push({
          id: uid(), kind: "ai", mode: nr.mode, input: nr.input,
          corrected: nr.corrected, errors: nr.errors, expressions: nr.expressions,
          summary: nr.summary, questions: nr.questions, timestamp: nr.timestamp,
        });
      }
      const tail = typeof r.body === "string" ? r.body : "";
      const lastIsUserMatching = blocks.length && blocks[blocks.length - 1].kind === "user" && blocks[blocks.length - 1].text === tail;
      if (tail.trim() && !lastIsUserMatching) blocks.push({ id: uid(), kind: "user", text: tail });
    }
    if (!blocks.length) blocks.push({ id: uid(), kind: "user", text: "" });
    // always end on a user block so there's somewhere to keep writing
    if (blocks[blocks.length - 1].kind !== "user") blocks.push({ id: uid(), kind: "user", text: "" });
    return { mode, blocks };
  }
  /* ── 역번역 normalization ── */
  function normRevDiff(d) {
    d = d && typeof d === "object" ? d : {};
    return {
      mine: typeof d.mine === "string" ? d.mine : "",
      targetFrag: typeof d.targetFrag === "string" ? d.targetFrag : "",
      category: REV_CATEGORIES.includes(d.category) ? d.category : "structure",
      note: typeof d.note === "string" ? d.note : "",
      // what the reader hand-copied of the correct sentence (their own, not the AI's)
      practice: typeof d.practice === "string" ? d.practice : "",
    };
  }
  function normRevAnalysis(a) {
    if (!a || typeof a !== "object") return null;
    return {
      verdict: typeof a.verdict === "string" ? a.verdict : "",
      diffs: Array.isArray(a.diffs) ? a.diffs.map(normRevDiff) : [],
      better: Array.isArray(a.better) ? a.better.filter((x) => typeof x === "string") : [],
    };
  }
  function normRevAttempt(a) {
    a = a && typeof a === "object" ? a : {};
    return {
      id: typeof a.id === "string" && a.id ? a.id : uid(),
      timestamp: a.timestamp || nowISO(),
      text: typeof a.text === "string" ? a.text : "",
      analysis: normRevAnalysis(a.analysis),
    };
  }
  // One 문단 of a 역번역 document: the drill (koSource/target/attempts) plus the
  // 필사 study layer over the revealed target — highlights, a Korean reading, its
  // correction history, and △ threads. Offsets are into `target`.
  function normRevPassage(p) {
    p = p && typeof p === "object" ? p : {};
    return {
      id: typeof p.id === "string" && p.id ? p.id : uid(),
      koSource: typeof p.koSource === "string" ? p.koSource : "",
      target: typeof p.target === "string" ? p.target : "",
      attempts: Array.isArray(p.attempts) ? p.attempts.map(normRevAttempt) : [],
      nextRevisit: typeof p.nextRevisit === "string" && p.nextRevisit ? p.nextRevisit.slice(0, 10) : null,
      stage: REV_STAGES.includes(p.stage) ? p.stage : "new",
      highlights: Array.isArray(p.highlights) ? p.highlights.filter((h) => h && h.endChar > h.startChar).map((h) => ({
        id: h.id || uid(), startChar: h.startChar | 0, endChar: h.endChar | 0,
        type: h.type === "blue" ? "blue" : "yellow", note: h.note || "",
      })) : [],
      interpretation: typeof p.interpretation === "string" ? p.interpretation : "",
      corrections: Array.isArray(p.corrections) ? p.corrections.filter((c) => c && typeof c === "object").map((c) => ({
        timestamp: c.timestamp || nowISO(), previousText: c.previousText || "", newText: c.newText || "",
      })) : [],
      threads: Array.isArray(p.threads) ? p.threads.map(normThread) : [],
    };
  }
  function blankRevPassage() { return normRevPassage({}); }
  function normReverse(r) {
    r = r && typeof r === "object" ? r : {};
    // legacy: a single flat drill on `reverse` itself → becomes 문단 1
    const passages = (Array.isArray(r.passages) && r.passages.length)
      ? r.passages.map(normRevPassage)
      : [normRevPassage(r)];
    return { passages };
  }
  // kind: 'speech' — 발표 연습: a spoken run-through of a project's material,
  // transcribed in the browser, hand-corrected, then reviewed by Claude against
  // the project's sources. Audio itself is never stored — transcript only.
  function normSpeechAnalysis(a) {
    if (!a || typeof a !== "object") return null;
    return {
      verdict: typeof a.verdict === "string" ? a.verdict : "",
      missed: Array.isArray(a.missed) ? a.missed.filter((x) => typeof x === "string").slice(0, 10) : [],
      diffs: Array.isArray(a.diffs) ? a.diffs.map(normRevDiff) : [],
    };
  }
  function normSpeech(s) {
    s = s && typeof s === "object" ? s : {};
    const dur = Number(s.durationSec);
    return {
      keywords: Array.isArray(s.keywords) ? s.keywords.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 12) : [],
      durationSec: Number.isFinite(dur) && dur > 0 ? Math.floor(dur) : 0,
      transcript: typeof s.transcript === "string" ? s.transcript : "",
      rawTranscript: typeof s.rawTranscript === "string" ? s.rawTranscript : "",
      analysis: normSpeechAnalysis(s.analysis),
    };
  }
  function normPattern(p) {
    p = p && typeof p === "object" ? p : {};
    const hits = Number(p.hits);
    return {
      id: typeof p.id === "string" && p.id ? p.id : uid(),
      mine: typeof p.mine === "string" ? p.mine : "",
      targetFrag: typeof p.targetFrag === "string" ? p.targetFrag : "",
      category: REV_CATEGORIES.includes(p.category) ? p.category : "structure",
      note: typeof p.note === "string" ? p.note : "",
      starred: !!p.starred,
      sourceEntryId: typeof p.sourceEntryId === "string" ? p.sourceEntryId : "",
      createdAt: p.createdAt || nowISO(),
      hits: Number.isFinite(hits) && hits >= 1 ? Math.floor(hits) : 1,
    };
  }

  function normEntry(e) {
    e = e && typeof e === "object" ? e : {};
    const s = e.source && typeof e.source === "object" ? e.source : {};
    const kind = kindOf(e.kind);
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
      out.reflection = normReflection(r);
    } else if (kind === "reverse") {
      out.reverse = normReverse(e.reverse);
    } else if (kind === "speech") {
      out.speech = normSpeech(e.speech);
    } else {
      let passages;
      if (Array.isArray(e.passages) && e.passages.length) {
        passages = e.passages.map(normPassage);
      } else {
        passages = [normPassage({
          id: uid(), body: e.body, highlights: e.highlights,
          interpretation: e.interpretation, corrections: e.corrections,
          threads: e.threads, messages: e.messages,
        })];
      }
      out.passages = passages;
      const p0 = passages[0];
      out.body = p0.body;
      out.highlights = p0.highlights;
      out.interpretation = p0.interpretation;
      out.corrections = p0.corrections;
      out.threads = p0.threads;
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
      patterns: Array.isArray(v.patterns) ? v.patterns.filter((x) => x && typeof x === "object").map(normPattern) : [],
      settings: {
        artAesthetic: (v.settings && v.settings.artAesthetic) || "cha",
        curatorNote: (v.settings && v.settings.curatorNote) || "",
        unpublishedIds: (v.settings && Array.isArray(v.settings.unpublishedIds)) ? v.settings.unpublishedIds : [],
        kitsTaken: (v.settings && Array.isArray(v.settings.kitsTaken)) ? v.settings.kitsTaken.filter((x) => typeof x === "string") : [],
        // set once the intro tour has been finished or skipped; synced, so it
        // doesn't reappear on a second device
        tourSeenAt: (v.settings && typeof v.settings.tourSeenAt === "string") ? v.settings.tourSeenAt : "",
      },
    };
  }

  const findEntry = (id) => state.entries.find((e) => e.id === id) || null;
  const currentEntry = () => findEntry(currentId);
  // 사유 was removed from the app. Existing reflection entries stay in `state.entries`
  // so they keep syncing and keep appearing in JSON backups — they're just never shown.
  // 발표 (speech) entries live only in their project's 오답노트, not in the daily flow.
  const isShown = (e) => e && e.kind !== "reflection" && e.kind !== "speech";
  function orderedEntries() {
    return state.entries.filter(isShown).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function entriesChrono() {
    return [...state.entries].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  function touchEntry(e) { if (!e) return; e.updatedAt = nowISO(); syncTopLevelToPassage(e); dirtyEntries.add(e.id); scheduleSync(); cacheLocal(); }

  /* ── passages (multiple body/interp/claude blocks per transcription entry) ── */
  function activePassage(e) {
    if (!e || e.kind !== "transcription" || !Array.isArray(e.passages)) return null;
    return e.passages.find((p) => p.id === currentPassageId) || e.passages[0] || null;
  }
  function syncTopLevelToPassage(e) {
    if (!e || e.kind !== "transcription") return;
    if (!Array.isArray(e.passages) || !e.passages.length) return;
    const idx = e.passages.findIndex((p) => p.id === currentPassageId);
    const i = idx >= 0 ? idx : 0;
    const p = e.passages[i];
    p.body = e.body || "";
    p.highlights = e.highlights || [];
    p.interpretation = e.interpretation || "";
    p.corrections = e.corrections || [];
    p.threads = e.threads || [];
  }
  function loadPassageIntoTopLevel(e, passId) {
    if (!e || e.kind !== "transcription") return;
    const p = (Array.isArray(e.passages) && e.passages.find((x) => x.id === passId)) || (e.passages && e.passages[0]);
    if (!p) return;
    currentPassageId = p.id;
    e.body = p.body || "";
    e.highlights = p.highlights || [];
    e.interpretation = p.interpretation || "";
    e.corrections = p.corrections || [];
    e.threads = p.threads || [];
  }
  function switchActivePassage(passId) {
    const e = currentEntry();
    if (!e || e.kind !== "transcription") return;
    if (passId === currentPassageId) return;
    if (editing) { try { exitEdit(); } catch (_) {} }
    captureInterpCorrection();
    syncTopLevelToPassage(e);
    loadPassageIntoTopLevel(e, passId);
    renderEntry();
    setTimeout(() => {
      const card = D.passagesContainer && D.passagesContainer.querySelector(`[data-pass="${passId}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 30);
  }
  function addPassageToCurrent() {
    const e = currentEntry();
    if (!e || e.kind !== "reflection") {
      if (!e) return;
      // sync current edits first
      syncTopLevelToPassage(e);
      const np = blankPassage();
      if (!Array.isArray(e.passages)) e.passages = [];
      e.passages.push(np);
      loadPassageIntoTopLevel(e, np.id);
      touchEntry(e);
      renderEntry();
      setTimeout(() => {
        try { D.bodyRender.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
        // jump straight into edit on the new (empty) passage
        try { if (typeof enterEdit === "function") enterEdit(0); } catch (_) {}
      }, 40);
    }
  }
  function deletePassage(passId) {
    const e = currentEntry();
    if (!e || e.kind !== "transcription" || !Array.isArray(e.passages)) return;
    if (e.passages.length <= 1) { toast("문단이 하나뿐입니다 — 삭제 대신 내용을 비워 보세요."); return; }
    const idx = e.passages.findIndex((p) => p.id === passId);
    if (idx < 0) return;
    const wasActive = passId === currentPassageId;
    // remove threads of this passage from terms encounters (those records live in app_state.terms)
    // — terms point to entryId only, so no per-passage cleanup needed here
    e.passages.splice(idx, 1);
    if (wasActive) {
      const nextIdx = Math.min(idx, e.passages.length - 1);
      loadPassageIntoTopLevel(e, e.passages[nextIdx].id);
    }
    touchEntry(e);
    renderEntry();
  }
  function touchAppState() { dirtyAppState = true; scheduleSync(); cacheLocal(); }

  /* ─────────────────────── TERMS ─────────────────────── */
  let termWords = new Set();
  const wordRe = /[A-Za-z][A-Za-z'’-]*/g;
  function rebuildTermIndex() { termWords = new Set(state.terms.map((t) => t.word).filter(Boolean)); }
  function findTerm(w) { w = normWord(w); return state.terms.find((t) => t.word === w) || null; }
  function upsertEncounter(entry, hl) { upsertEncounterIn(entry, entry.body, hl); }
  // `text` is whatever the offsets index into — a 필사 passage body, or a
  // 역번역 문단's revealed target
  function upsertEncounterIn(entry, text, hl) {
    const raw = String(text || "").slice(hl.startChar, hl.endChar);
    const w = normWord(raw);
    if (!w || w.length < 2) return;
    let term = findTerm(w);
    if (!term) { term = { id: uid(), word: w, definitions: [], encounters: [] }; state.terms.push(term); }
    const ctx = sentenceAround(String(text || ""), hl.startChar, hl.endChar).text;
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
  // every △ thread in the app: 필사 passages and 역번역 문단s alike
  function allThreads() {
    const out = [];
    for (const e of state.entries) {
      if (e.kind === "transcription") {
        for (const p of (Array.isArray(e.passages) ? e.passages : [e])) {
          for (const t of (p.threads || [])) out.push({ entry: e, thread: t, text: p.body || "" });
        }
      } else if (e.kind === "reverse") {
        for (const p of (e.reverse && Array.isArray(e.reverse.passages) ? e.reverse.passages : [])) {
          for (const t of (p.threads || [])) out.push({ entry: e, thread: t, text: p.target || "" });
        }
      }
    }
    return out;
  }
  function termClaudeNotes(word) {
    const out = [];
    for (const { entry, thread } of allThreads()) {
      if (normWord(thread.anchorText) !== word) continue;
      for (const m of thread.messages) if (m.role === "assistant" && !m.pending) out.push({ entry, thread, msg: m });
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
      data.reflection = e.reflection || { mode: "correct", blocks: [{ id: uid(), kind: "user", text: "" }] };
    } else if (e.kind === "reverse") {
      data.reverse = e.reverse && Array.isArray(e.reverse.passages) ? e.reverse : normReverse(e.reverse);
    } else if (e.kind === "speech") {
      data.speech = e.speech && typeof e.speech === "object" ? e.speech : normSpeech(e.speech);
    } else {
      syncTopLevelToPassage(e); // make sure passages[active] holds latest top-level edits
      data.passages = e.passages || [];
      // also persist the active passage's content at top level so older readers still work
      data.body = e.body; data.highlights = e.highlights;
      data.interpretation = e.interpretation; data.corrections = e.corrections; data.threads = e.threads;
    }
    return { id: e.id, user_id: user.id, entry_date: e.date, updated_at: e.updatedAt, created_at: e.createdAt, data };
  }
  function rowToEntry(r) {
    const d = r.data || {};
    return normEntry({ id: r.id, date: r.entry_date, kind: d.kind, source: d.source,
      // `passages` MUST be read back — entryToRow writes it, and without it every
      // multi-passage document collapses to its first passage on the next pull.
      passages: d.passages,
      body: d.body, highlights: d.highlights, interpretation: d.interpretation, corrections: d.corrections,
      threads: d.threads, messages: d.messages, reflection: d.reflection, reverse: d.reverse, speech: d.speech,
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
      // never swap entry objects out from under an in-flight AI call
      if (aiBusy) { setSync("ok"); return; }
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
        const rPatterns = Array.isArray(ar.data.patterns) ? ar.data.patterns : [];
        const rSettings = ar.data.settings || {};
        const remoteNewer = !state.__appUpdatedAt || String(ar.data.updated_at) >= String(state.__appUpdatedAt);
        if (remoteNewer) {
          state.terms = normVault({ terms: rTerms }).terms;
          state.settings = normVault({ settings: rSettings }).settings;
          // `patterns` arrived with 역번역 — an older row simply has none yet, so an
          // empty remote list must not wipe locally-collected ones.
          if (rPatterns.length || !state.patterns || !state.patterns.length) state.patterns = normVault({ patterns: rPatterns }).patterns;
          else dirtyAppState = true;
        }
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
    if (!dirtyEntries.size && !dirtyAppState && !deletedEntries.size) { setSync("ok"); return; }
    if (syncBusy) { syncAgain = true; return; }
    // NOTE: we deliberately do NOT gate on navigator.onLine — it gives false
    // negatives that silently block all uploads. Just try; failures are caught
    // and the entry stays dirty for the next retry.
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
        let { data, error } = await sb.from("app_state").upsert(
          { user_id: user.id, terms: state.terms, patterns: state.patterns, settings: state.settings, updated_at: nowISO() }, { onConflict: "user_id" }
        ).select().maybeSingle();
        // a project whose `patterns` column isn't migrated yet must not lose terms/settings sync
        if (error && /patterns/i.test(String(error.message || ""))) {
          console.warn("[pilsa] app_state.patterns column missing — run migration 0002");
          ({ data, error } = await sb.from("app_state").upsert(
            { user_id: user.id, terms: state.terms, settings: state.settings, updated_at: nowISO() }, { onConflict: "user_id" }
          ).select().maybeSingle());
        }
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
    if (!user || (!dirtyEntries.size && !dirtyAppState && !deletedEntries.size)) return;
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) return;
      const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}`, Prefer: "resolution=merge-duplicates" };
      const rows = [...dirtyEntries].map(findEntry).filter(Boolean).map(entryToRow);
      if (rows.length) fetch(`${SUPABASE_URL}/rest/v1/entries?on_conflict=id`, { method: "POST", headers, body: JSON.stringify(rows), keepalive: true });
      if (dirtyAppState) fetch(`${SUPABASE_URL}/rest/v1/app_state?on_conflict=user_id`, { method: "POST", headers, body: JSON.stringify([{ user_id: user.id, terms: state.terms, patterns: state.patterns, settings: state.settings, updated_at: nowISO() }]), keepalive: true });
    } catch (_) {}
  }
  // re-pull from the cloud when the tab regains focus, so a second device
  // picks up what was written elsewhere. Skips the re-render while you're typing.
  let lastPullAt = 0;
  async function pullAndRefresh() {
    if (!user || document.hidden) return;
    if (aiBusy) return; // never swap state.entries while an AI call is in flight
    if (Date.now() - lastPullAt < 2500) return;
    lastPullAt = Date.now();
    const sigBefore = state.entries.map((e) => e.id + ":" + e.updatedAt).sort().join("|");
    await pullAll();
    const sigAfter = state.entries.map((e) => e.id + ":" + e.updatedAt).sort().join("|");
    if (sigBefore === sigAfter) return; // nothing changed remotely
    refreshSourceDatalists();
    renderRecentList();
    renderSidebarCounts();
    const ae = document.activeElement;
    const typing = editing || (ae && /^(TEXTAREA|INPUT)$/.test(ae.tagName || ""));
    if (typing) { toast("다른 기기의 변경을 받았습니다 — 편집을 마치면 보입니다"); return; }
    if (!currentEntry() && currentId) currentId = (orderedEntries()[0] || {}).id || null;
    renderRoute();
  }

  /* ─────────────────────── DOM REFS ─────────────────────── */
  const D = {};
  function bindRefs() {
    [
      "authView","authForm","authEmail","authPassword","authPassword2","authHint","authSubmit","authMsg","authTabs","authNote",
      "app","sidebar","sidebarToggle","wordmark","syncDot","newEntryBtn","searchBtn","wordsBtn","sentencesBtn",
      "wordsCount","sentencesCount","recentList","revisitBlock","revisitList","exportBtn","importBtn","signOutBtn","importInput","sidebarReopen","main",
      "emptyState","emptyNewBtn","entryView","entryDate","entryWeekday","entryStatus","deleteEntryBtn","srcAuthor","srcTitle","srcPage",
      "bodyField","bodyRender","bodyEditWrap","bodyBackdrop","bodyInput","hlToolbar","slashMenu","slashMenuList","bodyHint","interpInput","interpSend","interpRevisions",
      "claudePanel","claudeHead","claudeTitle","claudeChevron","claudeBody","threadList","claudeCompose","claudeInput","claudeSend","claudeWarn","addParagraphBtn","passagesBefore","passagesAfter",
      "reverseView","revDate","revWeekday","revStageBadge","revDeleteBtn","revAuthor","revTitle","revPage",
      "revSetup","revSetupKo","revSetupTarget","revSetupSave","revSetupCancel",
      "revWrite","revKo","revAttemptH","revAttemptInput","revSubmit","revWriteMeta","revEditSetup","revPrior","revCompare",
      "revPassBefore","revPassAfter","revAddPassage","revHlToolbar",
      "patternsBtn","patternsCount","patternsView","patternsSub","patternsFilter","patternsStarFilter","patternsCats","patternList",
      "libraryBtn","libraryCount","libraryView","librarySub","kitGrid",
      "wordsView","wordsSub","wordsFilter","wordsSort","wordsGrid","sentencesView","sentencesSub","sentencesFilter","sentenceList",
      "projectsBtn","projectsCount","projectsView","projectsSort","projectsFilter","projectsGrid","projectsKindFilter","projectsNewBtn",
      "projectDetailView","projectBackBtn","projectCuratorEditBtn","projectArtScroll","projectDetailTabs",
      "searchScrim","searchInput","searchClose","searchFilters","chipColor","chipClaude","chipFrom","chipTo","chipAuthor","searchResults",
      "modalScrim","modalClose","modalTitle","modalBody","modalActions","wordTip","toast",
      "tourBtn","tour","tourSpot","tourCard","tourStep","tourTitle","tourText","tourDots","tourSkip","tourPrev","tourNext",
      "authorList","titleList",
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
  function closeModal() { stopSpeechRec(); D.modalScrim.hidden = true; D.modalBody.innerHTML = ""; }

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
    [D.emptyState, D.entryView, D.reverseView, D.wordsView, D.sentencesView, D.patternsView, D.libraryView, D.projectsView, D.projectDetailView].forEach((v) => (v.hidden = true));
    D.searchScrim.hidden = true;
    [D.searchBtn, D.wordsBtn, D.sentencesBtn, D.patternsBtn, D.libraryBtn, D.projectsBtn].forEach((b) => b.classList.remove("is-on"));
    if (name === "library") { D.libraryBtn.classList.add("is-on"); D.libraryView.hidden = false; renderLibraryView(); }
    else if (name === "patterns") { D.patternsBtn.classList.add("is-on"); D.patternsView.hidden = false; renderPatternsView(); }
    else if (name === "words") { D.wordsBtn.classList.add("is-on"); D.wordsView.hidden = false; renderWordsView(); }
    else if (name === "sentences") { D.sentencesBtn.classList.add("is-on"); D.sentencesView.hidden = false; renderSentencesView(); }
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
    if (!orderedEntries().length) { D.emptyState.hidden = false; D.entryView.hidden = true; D.reverseView.hidden = true; return; }
    if (!isShown(currentEntry())) {
      let openId = null;
      try { openId = localStorage.getItem(lastOpenKey()); } catch (_) {}
      currentId = openId && isShown(findEntry(openId)) ? openId : (orderedEntries()[0] || {}).id || null;
    }
    const e = currentEntry();
    if (!e) { D.emptyState.hidden = false; return; }
    D.emptyState.hidden = true;
    if (e.kind === "reverse") {
      D.entryView.hidden = true; D.reverseView.hidden = false;
      renderReverseEntry();
    } else {
      D.reverseView.hidden = true; D.entryView.hidden = false;
      clearReverseDom();
      renderEntry();
    }
  }
  // Nothing of a 역번역 drill — least of all the target — stays behind in the DOM.
  function clearReverseDom() {
    D.revSetupKo.value = ""; D.revSetupTarget.value = "";
    D.revKo.textContent = ""; D.revAttemptInput.value = "";
    D.revCompare.innerHTML = ""; D.revPrior.innerHTML = "";
    D.revPassBefore.innerHTML = ""; D.revPassAfter.innerHTML = "";
    D.revHlToolbar.hidden = true;
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
    currentId = e.id; activeThreadId = null; revModeId = null; revPassageId = null;
    if (e.kind === "transcription" && Array.isArray(e.passages) && e.passages.length) {
      loadPassageIntoTopLevel(e, e.passages[0].id);
    } else currentPassageId = null;
    touchEntry(e); rememberOpen();
    if (parseHash().name !== "daily") location.hash = "#daily";
    else { showDaily(); renderRecentList(); }
    renderSidebarCounts();
    autoCloseSidebarIfNarrow();
    // Focus where it makes sense: if a project was pre-set, jump into the body so the user starts writing
    if (kind === "reverse") setTimeout(() => { try { D.revSetupKo.focus(); } catch (_) {} }, 0);
    else if (presetSource && (presetSource.author || presetSource.title)) {
      setTimeout(() => {
        try {
          D.bodyInput.focus();
        } catch (_) {}
      }, 0);
    } else D.srcAuthor.focus();
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
      <button type="button" class="doc-picker-card" data-kind="reverse">
        <span class="doc-picker-name">역번역</span>
        <span class="doc-picker-desc">내 한국어 원문에서 영어를 다시 만듭니다.<br/>정답지를 가린 채 쓰고, 제출하면 나란히 대조합니다.</span>
        <span class="doc-picker-kbd">⌘3</span>
      </button>`;
    function pick(kind) { closeModal(); document.removeEventListener("keydown", onKey, true); newEntry(kind); }
    wrap.addEventListener("click", (ev) => {
      const card = ev.target.closest(".doc-picker-card");
      if (card) pick(card.dataset.kind);
    });
    const PICK_KEYS = { 1: "transcription", 3: "reverse" };
    function onKey(ev) {
      if (D.modalScrim.hidden) { document.removeEventListener("keydown", onKey, true); return; }
      if ((ev.metaKey || ev.ctrlKey) && PICK_KEYS[ev.key]) {
        ev.preventDefault();
        pick(PICK_KEYS[ev.key]);
      }
    }
    document.addEventListener("keydown", onKey, true);
    openModal("어떤 문서를 시작할까요?", wrap);
  }
  function openEntry(id) {
    if (id === currentId && parseHash().name === "daily") return;
    captureInterpCorrection();
    // flush current entry's active passage before switching
    const prev = currentEntry();
    if (prev) syncTopLevelToPassage(prev);
    if (!findEntry(id)) return;
    currentId = id; activeThreadId = null; editing = false; revModeId = null; revPassageId = null;
    currentPassageId = null;
    const ne = currentEntry();
    if (ne && ne.kind === "transcription" && Array.isArray(ne.passages) && ne.passages.length) {
      loadPassageIntoTopLevel(ne, ne.passages[0].id);
    }
    rememberOpen();
    if (parseHash().name !== "daily") location.hash = "#daily";
    else { showDaily(); renderRecentList(); }
    autoCloseSidebarIfNarrow();
  }
  function deleteCurrentEntry() {
    const e = currentEntry(); if (!e) return;
    const kindLabel = kindLabelOf(e.kind);
    const label = srcLabel(e) || e.date;
    if (!confirm(`이 ${kindLabel}을(를) 삭제할까요?\n\n${label}\n\n되돌릴 수 없습니다.`)) return;
    state.entries = state.entries.filter((x) => x.id !== e.id);
    deletedEntries.add(e.id); dirtyEntries.delete(e.id);
    pruneEntryFromTerms(e.id);
    const nx = orderedEntries()[0];
    currentId = nx ? nx.id : null; revModeId = null; revPassageId = null;
    revDrafts.delete(e.id);
    scheduleSync(); cacheLocal();
    renderRecentList(); showDaily(); renderSidebarCounts();
    toast(`${kindLabel}을 삭제했습니다`);
  }

  // author/title autocomplete pools — populated from every prior entry
  function refreshSourceDatalists() {
    if (!D.authorList || !D.titleList) return;
    const authors = new Set(), titles = new Set();
    for (const e of state.entries) {
      const a = (e.source && e.source.author) || "";
      const t = (e.source && e.source.title) || "";
      if (a.trim()) authors.add(a.trim());
      if (t.trim()) titles.add(t.trim());
    }
    const aSorted = [...authors].sort((a, b) => a.localeCompare(b, "ko"));
    const tSorted = [...titles].sort((a, b) => a.localeCompare(b, "ko"));
    D.authorList.innerHTML = aSorted.map((v) => `<option value="${escAttr(v)}"></option>`).join("");
    D.titleList.innerHTML  = tSorted.map((v) => `<option value="${escAttr(v)}"></option>`).join("");
  }

  function srcLabel(e) {
    const p = [e.source.author, e.source.title].filter(Boolean);
    let s = p.join(" · ");
    if (e.source.page) s += (s ? " · " : "") + pageRef(e.source.page);
    return s;
  }

  function renderEntry() {
    const e = currentEntry(); if (!e) return;
    // make sure passages exist + an active passage is loaded into top-level
    if (e.kind === "transcription") {
      if (!Array.isArray(e.passages) || !e.passages.length) e.passages = [blankPassage()];
      if (!currentPassageId || !e.passages.some((p) => p.id === currentPassageId)) {
        loadPassageIntoTopLevel(e, e.passages[0].id);
      }
    }
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
    // static cards for other passages
    renderPassageCards();
  }
  function renderPassageCards() {
    const e = currentEntry();
    if (!D.passagesBefore || !D.passagesAfter) return;
    if (!e || e.kind !== "transcription" || !Array.isArray(e.passages) || e.passages.length <= 1) {
      D.passagesBefore.innerHTML = ""; D.passagesAfter.innerHTML = "";
      return;
    }
    const activeIdx = e.passages.findIndex((p) => p.id === currentPassageId);
    const beforeHtml = e.passages.slice(0, Math.max(activeIdx, 0)).map((p, i) => buildPassageCard(p, i + 1)).join("");
    const afterHtml  = e.passages.slice(activeIdx + 1).map((p, i) => buildPassageCard(p, activeIdx + 2 + i)).join("");
    D.passagesBefore.innerHTML = beforeHtml;
    D.passagesAfter.innerHTML  = afterHtml;
  }
  function buildPassageCard(p, displayNum) {
    const bodyText = (p.body || "").trim();
    const interpText = (p.interpretation || "").trim();
    const threadCount = Array.isArray(p.threads) ? p.threads.length : 0;
    const msgCount = Array.isArray(p.threads) ? p.threads.reduce((a, t) => a + (t.messages ? t.messages.length : 0), 0) : 0;
    const hlCount = Array.isArray(p.highlights) ? p.highlights.length : 0;
    const isLong = bodyText.length > 320;
    return `<div class="passage-card" data-pass="${escAttr(p.id)}" role="button" tabindex="0" title="이 문단으로 전환">
      <div class="passage-card-h">
        <span class="passage-card-num">문단 ${displayNum}</span>
        <span class="passage-card-meta">${hlCount ? `🖍 ${hlCount} ` : ""}${threadCount ? `△ ${msgCount}` : ""}</span>
      </div>
      <div class="passage-card-body${isLong ? "" : " tall"}">${bodyText ? esc(bodyText) : '<i style="opacity:.5">(빈 본문)</i>'}</div>
      ${interpText ? `<div class="passage-card-interp">${esc(interpText)}</div>` : ""}
      ${threadCount ? `<div class="passage-card-claude">△ Claude 대화 · ${threadCount}개 · ${msgCount}개 메시지</div>` : ""}
      <button class="passage-card-del" data-passdel="${escAttr(p.id)}" title="이 문단 삭제">× 삭제</button>
    </div>`;
  }

  /* ─────────────────────── 역번역 (reverse translation) ─────────────────────── */
  /* ── word-level diff — LCS over whitespace-split tokens (no dependencies) ── */
  const WD_CELL_CAP = 1200000; // ~1.2M cells; beyond that we skip the diff rather than stall
  function wdTokens(s) { return String(s == null ? "" : s).split(/(\s+)/).filter((t) => t !== ""); }
  function wdKey(t) {
    if (/^\s+$/.test(t)) return " ";
    const k = t.toLowerCase().replace(/[^a-z0-9'’]/g, "");
    return k || t.toLowerCase();
  }
  function wordDiff(aStr, bStr) {
    const a = wdTokens(aStr), b = wdTokens(bStr);
    const left = new Array(a.length).fill(false), right = new Array(b.length).fill(false);
    const n = a.length, m = b.length;
    if (!n || !m || n * m > WD_CELL_CAP) {
      return { a, b, left, right, changes: 0, skipped: n * m > WD_CELL_CAP };
    }
    const A = a.map(wdKey), B = b.map(wdKey);
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
      }
    }
    let i = 0, j = 0, changes = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) { if (A[i] !== " ") { left[i] = true; changes++; } i++; }
      else { if (B[j] !== " ") { right[j] = true; changes++; } j++; }
    }
    while (i < n) { if (A[i] !== " ") { left[i] = true; changes++; } i++; }
    while (j < m) { if (B[j] !== " ") { right[j] = true; changes++; } j++; }
    return { a, b, left, right, changes, skipped: false };
  }
  function wdRender(tokens, flags, cls) {
    let out = "";
    for (let k = 0; k < tokens.length; k++) {
      out += flags[k] ? `<span class="${cls}">${esc(tokens[k])}</span>` : esc(tokens[k]);
    }
    return out;
  }

  /* ── sentence context: find a fragment in its source text and return the whole
        sentence around it, plus where the fragment sits inside that sentence ── */
  function revLocate(hay, frag) {
    const H = String(hay == null ? "" : hay), F = String(frag == null ? "" : frag).trim();
    if (!H || !F) return null;
    let i = H.indexOf(F), len = F.length;
    if (i < 0) { i = H.toLowerCase().indexOf(F.toLowerCase()); }
    if (i < 0) {
      // the model may have normalized whitespace when quoting — match word-by-word
      const words = F.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (!words.length) return null;
      const m = new RegExp(words.join("\\s+"), "i").exec(H);
      if (!m) return null;
      i = m.index; len = m[0].length;
    }
    const s = sentenceAround(H, i, i + len);
    const raw = H.slice(s.start, s.end);
    const lead = raw.length - raw.replace(/^\s+/, "").length; // sentenceAround trims
    const at = i - s.start - lead;
    if (at < 0 || at + len > s.text.length) return { sentence: s.text, at: null, len: 0 };
    return { sentence: s.text, at, len };
  }
  function revMarkSentence(loc, cls) {
    if (!loc) return "";
    if (loc.at == null) return esc(loc.sentence);
    return esc(loc.sentence.slice(0, loc.at)) +
      `<span class="${cls}">${esc(loc.sentence.slice(loc.at, loc.at + loc.len))}</span>` +
      esc(loc.sentence.slice(loc.at + loc.len));
  }
  const revNormForMatch = (s) => String(s || "").toLowerCase().replace(/[\s]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

  /* ── pattern note (나의 패턴) ── */
  const patKey = (mine, frag) =>
    String(mine || "").toLowerCase().replace(/\s+/g, " ").trim() + " ⇒ " + String(frag || "").toLowerCase().replace(/\s+/g, " ").trim();
  function findPattern(key) {
    if (!Array.isArray(state.patterns)) state.patterns = [];
    return state.patterns.find((p) => patKey(p.mine, p.targetFrag) === key) || null;
  }
  // Same mine→targetFrag pair filed again = a repeated failure, so bump hits instead of duplicating.
  function filePattern(diff, entryId) {
    if (!Array.isArray(state.patterns)) state.patterns = [];
    const key = patKey(diff.mine, diff.targetFrag);
    const hit = findPattern(key);
    if (hit) {
      hit.hits += 1;
      if (diff.note && !hit.note) hit.note = diff.note;
      return "hit";
    }
    state.patterns.push(normPattern({
      mine: diff.mine, targetFrag: diff.targetFrag, category: diff.category, note: diff.note,
      starred: false, sourceEntryId: entryId || "", createdAt: nowISO(), hits: 1,
    }));
    return "new";
  }

  /* ── reverse entry view ── */
  let revMode = "write";          // "setup" | "write" | "compare"
  let revModeId = null;           // entry/passage key revMode belongs to
  let revPassageId = null;        // active 문단 in the open 역번역 entry
  let revTargetView = "diff";     // 목표 영문 column: "diff" | "read" (markable)
  let revShownAttemptId = null;   // attempt rendered in the compare panel
  let revBusy = false;
  const revDrafts = new Map();    // session-only drafts, keyed by entry id

  function revPassages(e) {
    if (!e || e.kind !== "reverse") return [];
    if (!e.reverse || !Array.isArray(e.reverse.passages) || !e.reverse.passages.length) e.reverse = normReverse(e.reverse);
    return e.reverse.passages;
  }
  // `reverseOf` is the ACTIVE 문단 — the rest of the view is written against one drill
  function reverseOf(e) {
    const ps = revPassages(e);
    return ps.find((p) => p.id === revPassageId) || ps[0];
  }
  const revDueOn = (p) => (p && p.nextRevisit && p.nextRevisit <= todayISO() ? p.nextRevisit : null);
  function revIsDue(e) {
    if (!e || e.kind !== "reverse") return false;
    return revPassages(e).some(revDueOn);
  }
  // the document's stage = the least advanced 문단 still in the cycle
  function revEntryStage(e) {
    const ps = revPassages(e);
    if (!ps.length) return "new";
    const due = ps.filter(revDueOn);
    if (due.length) return due.sort((a, b) => String(a.nextRevisit).localeCompare(String(b.nextRevisit)))[0].stage;
    return ps.map((p) => p.stage).sort((a, b) => REV_STAGES.indexOf(a) - REV_STAGES.indexOf(b))[0];
  }
  const revEntryNextRevisit = (e) =>
    revPassages(e).map((p) => p.nextRevisit).filter(Boolean).sort()[0] || null;
  function revAdvanceStage(rv) {
    if (rv.stage === "new") { rv.stage = "d3"; rv.nextRevisit = plusDaysISO(3); }
    else if (rv.stage === "d3") { rv.stage = "d14"; rv.nextRevisit = plusDaysISO(14); }
    else { rv.stage = "done"; rv.nextRevisit = null; }
  }

  function renderReverseEntry() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const ps = revPassages(e);
    if (!revPassageId || !ps.some((p) => p.id === revPassageId)) revPassageId = ps[0].id;
    const rv = reverseOf(e);

    const key = e.id + "/" + rv.id;
    if (revModeId !== key) { revModeId = key; revMode = "write"; revShownAttemptId = null; revTargetView = "diff"; }
    if (!rv.koSource.trim() || !rv.target.trim()) revMode = "setup";

    D.revDate.value = e.date;
    D.revWeekday.textContent = weekdayOf(e.date) ? "· " + weekdayOf(e.date) : "";
    D.revAuthor.value = e.source.author; D.revTitle.value = e.source.title; D.revPage.value = e.source.page;
    D.revStageBadge.hidden = false;
    D.revStageBadge.textContent = REV_STAGE_LABEL[rv.stage] || "1차";
    D.revStageBadge.className = "rev-stage-badge stage-" + rv.stage + (revDueOn(rv) ? " is-due" : "");
    renderRevPassageCards(e, ps, rv);

    D.revSetup.hidden = revMode !== "setup";
    D.revWrite.hidden = revMode !== "write";
    D.revCompare.hidden = revMode !== "compare";

    if (revMode === "setup") {
      D.revSetupKo.value = rv.koSource;
      D.revSetupTarget.value = rv.target;   // the one moment the target is allowed on screen
      autoGrow(D.revSetupKo, 600); autoGrow(D.revSetupTarget, 600);
      D.revSetupCancel.hidden = !(rv.koSource.trim() && rv.target.trim());
    } else {
      // leave nothing behind: the target must not be readable from the DOM in state A
      D.revSetupKo.value = ""; D.revSetupTarget.value = "";
    }

    if (revMode === "write") {
      D.revKo.textContent = rv.koSource;
      D.revAttemptH.textContent = `영어로 옮기기 · ${rv.attempts.length + 1}번째 시도`;
      D.revAttemptInput.value = revDrafts.get(e.id) || "";
      autoGrow(D.revAttemptInput, 900);
      D.revSubmit.disabled = revBusy;
      const bits = [];
      if (rv.attempts.length) bits.push(`지금까지 ${rv.attempts.length}번 제출`);
      if (rv.nextRevisit) bits.push(revDueOn(rv) ? "오늘 재시도" : `다음 재시도 ${fmtDate(rv.nextRevisit)}`);
      else if (rv.stage === "done") bits.push("주기 완료");
      D.revWriteMeta.textContent = bits.join(" · ");
      renderRevPrior(e);
    } else {
      D.revKo.textContent = "";
      D.revPrior.innerHTML = "";
    }

    if (revMode === "compare") {
      const at = rv.attempts.find((a) => a.id === revShownAttemptId) || rv.attempts[rv.attempts.length - 1] || null;
      if (!at) { revMode = "write"; renderReverseEntry(); return; }
      revShownAttemptId = at.id;
      renderReverseCompare(e, at);
    } else {
      D.revCompare.innerHTML = "";
    }
  }

  // 문단 카드 — koSource only. A card must never show another 문단's target.
  function renderRevPassageCards(e, ps, active) {
    if (ps.length <= 1) { D.revPassBefore.innerHTML = ""; D.revPassAfter.innerHTML = ""; return; }
    const at = ps.findIndex((p) => p.id === active.id);
    const card = (p, n) => {
      const ko = (p.koSource || "").trim();
      const done = p.attempts.length;
      return `<div class="passage-card rev-pass-card" data-revpass="${escAttr(p.id)}" role="button" tabindex="0" title="이 문단으로 전환">
        <div class="passage-card-h">
          <span class="passage-card-num">문단 ${n}</span>
          <span class="passage-card-meta"><span class="rev-stage-badge stage-${p.stage}${revDueOn(p) ? " is-due" : ""}">${esc(REV_STAGE_LABEL[p.stage])}</span>${done ? ` ${done}회` : ""}</span>
        </div>
        <div class="passage-card-body tall">${ko ? esc(ko) : '<i style="opacity:.5">(빈 원문)</i>'}</div>
        <button class="passage-card-del" data-revpassdel="${escAttr(p.id)}" title="이 문단 삭제">× 삭제</button>
      </div>`;
    };
    D.revPassBefore.innerHTML = ps.slice(0, Math.max(at, 0)).map((p, i) => card(p, i + 1)).join("");
    D.revPassAfter.innerHTML = ps.slice(at + 1).map((p, i) => card(p, at + 2 + i)).join("");
  }
  function addRevPassage() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const ps = revPassages(e);
    const p = blankRevPassage();
    ps.push(p);
    revPassageId = p.id;
    revMode = "setup"; revModeId = null;
    touchEntry(e);
    renderReverseEntry(); renderRecentList();
    setTimeout(() => { try { D.revSetupKo.focus(); } catch (_) {} }, 0);
  }
  function deleteRevPassage(id) {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const ps = revPassages(e);
    if (ps.length <= 1) { toast("문단이 하나뿐입니다 — 삭제 대신 내용을 고쳐 보세요."); return; }
    const i = ps.findIndex((p) => p.id === id); if (i < 0) return;
    if (!confirm("이 문단을 삭제할까요?\n시도 기록과 표시도 함께 사라집니다. 되돌릴 수 없습니다.")) return;
    const wasActive = id === revPassageId;
    ps.splice(i, 1);
    if (wasActive) { revPassageId = ps[Math.min(i, ps.length - 1)].id; revModeId = null; }
    touchEntry(e);
    renderReverseEntry(); renderRecentList(); renderSidebarCounts();
  }
  function switchRevPassage(id) {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    if (id === revPassageId) return;
    captureRevInterp();
    revPassageId = id; revModeId = null;
    renderReverseEntry();
    D.reverseView.scrollIntoView({ block: "start" });
  }

  /* ── the revealed target as a 필사 surface: marks, △ anchors, term underlines ── */
  function revBuildTargetHtml(p) {
    const text = p.target || "";
    if (!text) return "";
    const len = text.length;
    const hls = [...p.highlights].map((h) => ({ ...h, startChar: clamp(h.startChar, 0, len), endChar: clamp(h.endChar, 0, len) }))
      .filter((h) => h.endChar > h.startChar).sort((a, b) => a.startChar - b.startChar);
    const clean = []; let last = -1;
    for (const h of hls) if (h.startChar >= last) { clean.push(h); last = h.endChar; }
    const ev = [];
    for (const h of clean) { ev.push({ pos: h.startChar, k: 2, hl: h }); ev.push({ pos: h.endChar, k: 0, hl: h }); }
    for (const t of p.threads) if (Number.isFinite(t.anchorChar)) ev.push({ pos: clamp(t.anchorChar, 0, len), k: 1, thread: t });
    ev.sort((a, b) => a.pos - b.pos || a.k - b.k);
    let html = "", cur = 0, inHl = null;
    for (const x of ev) {
      const seg = text.slice(cur, x.pos);
      html += inHl ? esc(seg) : termWrap(seg);
      cur = x.pos;
      if (x.k === 2) {
        const raw = text.slice(x.hl.startChar, x.hl.endChar), n = normWord(raw);
        const isTerm = n && termWords.has(n);
        inHl = x.hl;
        html += `<mark class="hl-${x.hl.type}${isTerm ? " term-mark" : ""}"${isTerm ? ` data-term="${escAttr(n)}"` : ""}${x.hl.note ? ` data-note="${escAttr(x.hl.note)}"` : ""} data-hl="${escAttr(x.hl.id)}">`;
      } else if (x.k === 0) { html += "</mark>"; inHl = null; }
      else html += `<sup class="thread-anchor" data-thread="${escAttr(x.thread.id)}" title="Claude 대화"></sup>`;
    }
    const tail = text.slice(cur);
    html += inHl ? esc(tail) : termWrap(tail);
    if (inHl) html += "</mark>";
    return html;
  }

  function renderRevPrior(e) {
    const rv = reverseOf(e);
    if (!rv.attempts.length) { D.revPrior.innerHTML = ""; return; }
    const rows = rv.attempts.map((a, i) => {
      const n = a.analysis ? a.analysis.diffs.length : null;
      // read-only: fragments only, never whole target sentences — state A must stay covered
      const an = a.analysis
        ? `<details class="rev-prior-analysis"><summary>분석 보기${n != null ? ` · 차이 ${n}개` : ""}</summary>${revAnalysisHtml(a.analysis, null)}</details>`
        : `<div class="rev-prior-noan">— 분석 없음</div>`;
      return `<div class="rev-prior-item">
        <div class="rev-prior-h">${i + 1}번째 시도 · ${esc(fmtDate(a.timestamp))} ${esc(String(a.timestamp).slice(11, 16))}</div>
        <div class="rev-prior-text">${esc(a.text)}</div>
        ${an}
        <button type="button" class="rev-btn rev-btn--ghost" data-rev-open="${escAttr(a.id)}">이 시도 대조 보기</button>
      </div>`;
    }).join("");
    D.revPrior.innerHTML = `<details class="rev-prior-wrap"><summary>이전 시도 ${rv.attempts.length}개 보기</summary>${rows}</details>`;
  }

  function revCatBadge(cat) {
    return `<span class="cat-badge cat-${esc(cat)}">${esc(REV_CAT_LABEL[cat] || cat)}</span>`;
  }
  // `ctx` = { entryId, attemptText, target } → live compare card (sentence context +
  // 담기 picker + 필사 box). `null` → read-only fragment pairs for the prior-attempt list.
  function revAnalysisHtml(an, ctx) {
    if (!an) return "";
    let html = "", unfiled = 0;
    if (an.verdict) html += `<div class="rev-verdict">${esc(an.verdict)}</div>`;
    if (an.diffs.length) {
      html += `<div class="rev-diff-list">` + an.diffs.map((d, i) => {
        const filed = ctx ? findPattern(patKey(d.mine, d.targetFrag)) : null;
        if (ctx && !filed) unfiled++;
        const pick = !ctx ? ""
          : filed
            ? `<span class="rev-diff-filed" title="이미 나의 패턴에 있습니다">담김 · ${filed.hits}회</span>`
            : `<label class="rev-diff-pick"><input type="checkbox" data-rev-diff="${i}" checked /><span>담기</span></label>`;

        let pair, practice = "";
        if (ctx) {
          // whole sentence, with only the diverging part coloured
          const mLoc = revLocate(ctx.attemptText, d.mine);
          const tLoc = revLocate(ctx.target, d.targetFrag);
          const mineHtml = mLoc ? revMarkSentence(mLoc, "rev-x") : `<span class="rev-x">${esc(d.mine)}</span>`;
          const tgtHtml = tLoc ? revMarkSentence(tLoc, "rev-o") : `<span class="rev-o">${esc(d.targetFrag)}</span>`;
          pair = `<div class="rev-diff-pair">
            <div class="rev-sent-row"><span class="rev-diff-lbl">내</span><span class="rev-sent">${mineHtml || "<i>—</i>"}</span></div>
            <div class="rev-sent-row"><span class="rev-diff-lbl">목표</span><span class="rev-sent">${tgtHtml || "<i>—</i>"}</span></div>
          </div>`;
          const model = tLoc ? tLoc.sentence : d.targetFrag;
          const done = !!d.practice.trim() && revNormForMatch(d.practice) === revNormForMatch(model);
          practice = `<div class="rev-practice${done ? " is-done" : ""}" data-model="${escAttr(model)}">
            <div class="rev-practice-h">맞는 문장 필사${done ? `<span class="rev-practice-ok">✓ 일치</span>` : ""}</div>
            <textarea class="rev-practice-input" data-rev-practice="${i}" spellcheck="false"
              placeholder="위 목표 문장을 그대로 옮겨 적습니다.">${esc(d.practice)}</textarea>
          </div>`;
        } else {
          pair = `<div class="rev-diff-pair">
            <div class="rev-sent-row"><span class="rev-diff-lbl">내</span><span class="rev-frag rev-x">${esc(d.mine) || "—"}</span></div>
            <div class="rev-sent-row"><span class="rev-diff-lbl">목표</span><span class="rev-frag rev-o">${esc(d.targetFrag) || "—"}</span></div>
          </div>`;
        }
        return `<div class="rev-diff">
          <div class="rev-diff-top">${revCatBadge(d.category)}${pick}</div>
          ${pair}
          ${d.note ? `<div class="rev-diff-note">${esc(d.note)}</div>` : ""}
          ${practice}
        </div>`;
      }).join("") + `</div>`;
    } else {
      html += `<div class="rev-none">— 유의미한 차이가 없습니다.</div>`;
    }
    if (an.better.length) {
      html += `<div class="rev-better-h">내 쪽이 나은 지점</div><ul class="rev-better">` +
        an.better.map((b) => `<li>${esc(b)}</li>`).join("") + `</ul>`;
    }
    if (unfiled) {
      html += `<div class="rev-foot"><button type="button" class="rev-btn rev-btn--primary" id="revFileBtn">분석을 패턴 노트에 담기</button></div>`;
    } else if (ctx && an.diffs.length) {
      html += `<div class="rev-foot"><span class="rev-meta">이 분석의 갈림은 모두 「나의 패턴」에 있습니다</span></div>`;
    }
    return html;
  }

  function renderReverseCompare(e, at) {
    const rv = reverseOf(e);
    const idx = rv.attempts.findIndex((a) => a.id === at.id);
    const d = wordDiff(at.text, rv.target);
    // improvement is only meaningful between two analyzed attempts
    let delta = "";
    const prev = idx > 0 ? rv.attempts[idx - 1] : null;
    if (prev && prev.analysis && at.analysis) {
      const diffNow = at.analysis.diffs.length, diffPrev = prev.analysis.diffs.length;
      delta = diffNow < diffPrev ? `이전보다 지적 ${diffPrev - diffNow}개 줄었습니다`
        : diffNow > diffPrev ? `이전보다 지적 ${diffNow - diffPrev}개 늘었습니다`
        : "이전과 지적 수가 같습니다";
    }
    const analysis = at.analysis
      ? revAnalysisHtml(at.analysis, { entryId: e.id, attemptText: at.text, target: rv.target })
      : revBusy
        ? `<div class="rev-analyzing">Claude가 대조 분석 중…</div>`
        : `<div class="rev-analyzing is-failed">분석이 아직 없습니다.<button type="button" class="rev-btn rev-btn--ghost" id="revRetryBtn">다시 분석</button></div>`;

    const reading = revTargetView === "read";
    const nCorr = rv.corrections.length;
    const threadCount = rv.threads.reduce((a, t) => a + t.messages.length, 0);

    D.revCompare.innerHTML = `
      <div class="rev-cmp-head">
        <span class="rev-cmp-n">${idx + 1}번째 시도</span>
        <span class="rev-cmp-ts">${esc(fmtDate(at.timestamp))} ${esc(String(at.timestamp).slice(11, 16))}</span>
        ${delta ? `<span class="rev-cmp-delta">${esc(delta)}</span>` : ""}
        <button type="button" class="rev-btn rev-btn--ghost" id="revBackToWrite">다시 쓰기</button>
      </div>
      <div class="rev-cols">
        <div class="rev-col">
          <div class="rev-col-h">내 시도</div>
          <div class="rev-col-body">${wdRender(d.a, d.left, "wd-del")}</div>
        </div>
        <div class="rev-col">
          <div class="rev-col-h">
            목표 영문
            <span class="rev-col-seg">
              <button type="button" data-tview="diff"${reading ? "" : ' class="is-on"'}>대조</button>
              <button type="button" data-tview="read"${reading ? ' class="is-on"' : ""}>표시</button>
            </span>
          </div>
          ${reading
            ? `<div class="rev-col-body rev-target-read" id="revTargetRead" data-revtarget>${revBuildTargetHtml(rv)}</div>`
            /* the diff spans hold the target's tokens verbatim and in order, so text
               offsets match the target string exactly — it is markable here too */
            : `<div class="rev-col-body rev-target-read" data-revtarget>${wdRender(d.b, d.right, "wd-ins")}</div>`}
        </div>
      </div>
      <div class="rev-note-small">${d.skipped ? "문단이 너무 길어 단어 대조는 건너뛰었습니다." : `단어 차이 ${d.changes}개`}
        <span class="rev-mark-hint">· 목표 영문을 드래그하면 🟡 단어 · 🔵 구절 · △ 묻기</span></div>
      <div class="rev-analysis">${analysis}</div>

      <section class="rev-study">
        <div class="rev-h">이 문단에 대한 나의 해석</div>
        <textarea class="rev-interp-input" id="revInterpInput"
          placeholder="목표 영문을 한국어로 옮겨 보거나, 읽으며 떠오른 것을 적습니다.&#10;⌘↵ 로 보내면 Claude가 답하면서 단어·문장을 노트에 정리해 둡니다.">${esc(rv.interpretation)}</textarea>
        <div class="rev-foot">
          <button type="button" class="rev-btn" id="revInterpSend">△ Claude에게 보내기<kbd>⌘↵</kbd></button>
          ${nCorr ? `<button type="button" class="rev-btn rev-btn--ghost" id="revRevisions">${nCorr}번 고쳐 씀 — 이전 해석 보기</button>` : ""}
        </div>
        <div class="rev-threads" id="revThreads">${revThreadsHtml(rv)}</div>
        ${threadCount ? "" : `<div class="rev-note-small">아직 △ 대화가 없습니다.</div>`}
      </section>`;
    D.revCompare.querySelectorAll(".rev-practice-input").forEach((ta) => autoGrow(ta, 260));
    const ii = $("revInterpInput");
    if (ii) { autoGrow(ii, 420); revInterpSnapshot = rv.interpretation; }
  }
  function revThreadsHtml(p) {
    if (!p.threads.length) return "";
    return [...p.threads].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((t) => {
      const head = t.anchorText
        ? `<div class="thread-anchor-quote" data-revjump="${escAttr(t.id)}"><span class="tri">△</span><span class="q">${esc(t.anchorText)}</span><button class="thread-del" data-revthdel="${escAttr(t.id)}">삭제</button></div>`
        : `<div class="thread-anchor-quote"><span class="q" style="font-family:var(--font-sans);font-style:normal;color:var(--color-text-tertiary);">나의 해석·질문에 대한 Claude</span><button class="thread-del" data-revthdel="${escAttr(t.id)}">삭제</button></div>`;
      const msgs = t.messages.map((m) => m.role === "user"
        ? `<div class="msg role-user"><span class="msg-who">나</span><div class="msg-content">${esc(m.content)}</div></div>`
        : m.pending
          ? `<div class="msg role-assistant pending"><span class="msg-who">Claude</span><div class="msg-content">…생각 중</div></div>`
          : `<div class="msg role-assistant"><span class="msg-who">Claude</span><div class="msg-content">${mdInline(m.content)}</div></div>`).join("");
      return `<div class="thread">${head}${msgs}</div>`;
    }).join("");
  }

  function saveReverseSetup() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const rv = reverseOf(e);
    const ko = D.revSetupKo.value.trim(), tg = D.revSetupTarget.value.trim();
    if (!ko) { D.revSetupKo.focus(); toast("한국어 원문을 붙여넣어 주세요"); return; }
    if (!tg) { D.revSetupTarget.focus(); toast("목표 영문을 붙여넣어 주세요"); return; }
    rv.koSource = ko; rv.target = tg;
    touchEntry(e);
    revMode = "write";
    renderReverseEntry();
    renderRecentList();
    setTimeout(() => { try { D.revAttemptInput.focus(); } catch (_) {} }, 0);
  }

  async function submitReverseAttempt() {
    if (revBusy) return;
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const rv = reverseOf(e);
    const text = D.revAttemptInput.value.trim();
    if (!text) { D.revAttemptInput.focus(); toast("먼저 영어로 옮겨 적어 주세요"); return; }
    if (!rv.target.trim()) { revMode = "setup"; renderReverseEntry(); return; }

    // append-only: the attempt is recorded before Claude is called, and never rewritten
    const at = normRevAttempt({ id: uid(), timestamp: nowISO(), text, analysis: null });
    rv.attempts.push(at);
    revAdvanceStage(rv);
    revDrafts.delete(e.id);
    touchEntry(e);

    revBusy = true;
    revShownAttemptId = at.id;
    revMode = "compare";
    renderReverseEntry();
    renderRecentList(); renderSidebarCounts();
    try { D.revCompare.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}

    await runReverseAnalysis(e, at);
  }

  async function runReverseAnalysis(e, at) {
    const rv = reverseOf(e);
    revBusy = true;
    aiBusy++; // keep the 20s auto-pull from swapping state.entries mid-call
    if (revMode === "compare" && revShownAttemptId === at.id) renderReverseCompare(e, at);
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) throw new Error("로그인이 필요합니다");
      const prior = rv.attempts.filter((a) => a.id !== at.id).map((a) => a.text);
      const resp = await fetch(CLAUDE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          reverse: true,
          koSource: rv.koSource, target: rv.target, attempt: at.text, priorAttempts: prior,
          context: { author: e.source.author || "", title: e.source.title || "", page: e.source.page || "" },
        }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || out.error) throw new Error((out && out.error) ? out.error : `요청 실패 (${resp.status})`);
      at.analysis = normRevAnalysis(out.reverse || {});
      touchEntry(e);
      toast("대조 분석 완료");
    } catch (err) {
      toast("Claude 호출 실패 — " + (err.message || String(err)));
    } finally {
      revBusy = false;
      aiBusy = Math.max(0, aiBusy - 1);
      if (currentId === e.id && revMode === "compare") renderReverseCompare(e, at);
      else if (currentId === e.id) renderReverseEntry();
    }
  }

  /* ── marking the revealed target (필사 기능) ── */
  let revPendingSel = null;
  let revInterpSnapshot = "";
  function hideRevToolbar() { D.revHlToolbar.hidden = true; revPendingSel = null; }
  const revTargetEl = () => D.revCompare.querySelector("[data-revtarget]");
  function onRevTargetSelect() {
    const root = revTargetEl();
    if (!root) return hideRevToolbar();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideRevToolbar();
    const r = sel.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer)) return hideRevToolbar();
    const s = charOffsetIn(root, r.startContainer, r.startOffset);
    const t = charOffsetIn(root, r.endContainer, r.endOffset);
    const a = Math.min(s, t), b = Math.max(s, t);
    if (b <= a) return hideRevToolbar();
    revPendingSel = { s: a, e: b };
    const e = currentEntry(); const p = e && reverseOf(e);
    D.revHlToolbar.querySelector(".hl-btn--clear").hidden =
      !(p && p.highlights.some((h) => h.startChar < b && h.endChar > a));
    D.revHlToolbar.hidden = false;
    try {
      const rect = r.getBoundingClientRect();
      const tw = D.revHlToolbar.offsetWidth || 220, th = D.revHlToolbar.offsetHeight || 32;
      const left = clamp(rect.left + rect.width / 2 - tw / 2, 8, document.documentElement.clientWidth - tw - 8);
      let top = rect.top - th - 8;
      if (top < 8) top = rect.bottom + 8;
      D.revHlToolbar.style.left = left + "px";
      D.revHlToolbar.style.top = top + "px";
    } catch (_) { /* no layout to measure — the toolbar still works, just unmoved */ }
  }
  function repaintRevTarget() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    if (revTargetView !== "read") {
      // marked from the 대조 view — switch to 표시 so the mark is actually visible
      revTargetView = "read";
      renderReverseEntry();
      return;
    }
    const host = $("revTargetRead");
    if (host) host.innerHTML = revBuildTargetHtml(reverseOf(e));
  }
  function applyRevHighlight(type) {
    const sel = revPendingSel, e = currentEntry();
    if (!sel || !e || e.kind !== "reverse") return;
    const p = reverseOf(e);
    if (type === "ask") { hideRevToolbar(); askClaudeAboutRev(e, p, sel.s, sel.e); return; }
    const frag = type === "yellow" || type === "blue" ? p.target.slice(sel.s, sel.e).trim() : "";
    p.highlights = p.highlights.filter((h) => h.endChar <= sel.s || h.startChar >= sel.e);
    if (type !== "clear") {
      const hl = { id: uid(), startChar: sel.s, endChar: sel.e, type, note: "" };
      p.highlights.push(hl);
      if (type === "yellow") upsertEncounterIn(e, p.target, hl);   // feeds 나의 단어
    }
    touchEntry(e);
    hideRevToolbar();
    try { window.getSelection().removeAllRanges(); } catch (_) {}
    repaintRevTarget();
    if (frag) appendToRevInterp(frag);
    renderSidebarCounts();
  }
  function appendToRevInterp(frag) {
    const e = currentEntry(); if (!e) return;
    const p = reverseOf(e);
    const ta = $("revInterpInput"); if (!ta) return;
    const cur = ta.value;
    const val = cur + (cur.length && !/\n\s*$/.test(cur) ? "\n" : "") + frag + " : ";
    ta.value = val; p.interpretation = val;
    autoGrow(ta, 420); touchEntry(e);
    ta.focus();
    try { ta.setSelectionRange(val.length, val.length); } catch (_) {}
    revInterpSnapshot = val;
  }
  function captureRevInterp() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const ta = $("revInterpInput"); if (!ta) return;
    const p = reverseOf(e);
    const before = revInterpSnapshot, after = ta.value;
    if (after !== p.interpretation) { p.interpretation = after; touchEntry(e); }
    if (before.trim() !== "" && after !== before) {
      p.corrections.push({ timestamp: nowISO(), previousText: before, newText: after });
      touchEntry(e);
    }
    revInterpSnapshot = after;
  }
  function showRevRevisions() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const p = reverseOf(e);
    if (!p.corrections.length) return;
    const wrap = document.createElement("div");
    wrap.innerHTML =
      `<p style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:14px;">고쳐 쓴 자취는 지워지지 않습니다.</p>` +
      p.corrections.map((c) =>
        `<div style="margin-bottom:16px;padding-bottom:14px;border-bottom:0.5px solid var(--color-border-tertiary);">
          <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-tertiary);margin-bottom:6px;">${esc(fmtDate(c.timestamp))} ${esc(String(c.timestamp).slice(11, 16))}</div>
          <div style="font-family:var(--font-korean);font-size:13.5px;line-height:1.7;color:var(--color-text-tertiary);text-decoration:line-through;">${esc(c.previousText) || "<i>(빈 해석)</i>"}</div>
          <div style="font-family:var(--font-korean);font-size:13.5px;line-height:1.7;color:var(--color-text-primary);margin-top:4px;">${esc(c.newText) || "<i>(빈 해석)</i>"}</div>
        </div>`).join("") +
      `<div style="font-family:var(--font-korean);font-size:13.5px;line-height:1.7;">지금: ${esc(p.interpretation) || "<i>(빈 해석)</i>"}</div>`;
    openModal("이전 해석들", wrap);
  }

  /* ── Claude on a 역번역 문단 (△ 묻기 · 해석 보내기) ── */
  async function runRevClaude(e, p, th, userText, opts) {
    opts = opts || {};
    if (claudeBusy) return;
    claudeBusy = true; aiBusy++;
    th.messages.push({ id: uid(), role: "user", content: userText, timestamp: nowISO() });
    const pending = { id: uid(), role: "assistant", content: "", pending: true, timestamp: nowISO() };
    th.messages.push(pending);
    th.updatedAt = nowISO();
    touchEntry(e);
    const host = $("revThreads"); if (host) host.innerHTML = revThreadsHtml(p);
    let added = null;
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const turns = th.messages.filter((m) => !m.pending && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));
      const context = { author: e.source.author, title: e.source.title, page: e.source.page,
        body: p.target, interpretation: p.interpretation, selection: th.anchorText || null };
      const resp = await fetch(CLAUDE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ messages: turns, context, extract: !!opts.extract }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || out.error) throw new Error((out && out.error) ? out.error : `요청 실패 (${resp.status})`);
      pending.pending = false; pending.content = out.text || "(빈 응답)";
      delete pending.pending;
      if (opts.extract && Array.isArray(out.picks) && out.picks.length) added = applyRevPicks(e, p, out.picks);
    } catch (err) {
      th.messages = th.messages.filter((m) => m.id !== pending.id);
      toast("Claude 호출 실패 — " + (err.message || String(err)));
    }
    claudeBusy = false; aiBusy = Math.max(0, aiBusy - 1);
    th.updatedAt = nowISO();
    touchEntry(e);
    if (currentId === e.id && revMode === "compare") renderReverseEntry();
    renderSidebarCounts();
    if (added && (added.words || added.phrases)) {
      const parts = [];
      if (added.words) parts.push(`단어 ${added.words}개`);
      if (added.phrases) parts.push(`문장 ${added.phrases}개`);
      toast(`Claude가 ${parts.join(" · ")}를 나의 노트에 더했습니다`);
    }
  }
  function applyRevPicks(e, p, picks) {
    let words = 0, phrases = 0;
    for (const pick of picks) {
      if (!pick || typeof pick !== "object") continue;
      const note = typeof pick.note === "string" ? pick.note.trim() : "";
      const raw = typeof pick.text === "string" ? pick.text.trim() : "";
      if (!raw) continue;
      if (pick.kind === "word") {
        const span = findWordSpan(p.target, raw);
        let w, ctx;
        if (span) {
          w = normWord(p.target.slice(span.start, span.end));
          ctx = sentenceAround(p.target, span.start, span.end).text;
          if (w && w.length >= 2 && !p.highlights.some((h) => h.startChar < span.end && h.endChar > span.start)) {
            p.highlights.push({ id: uid(), startChar: span.start, endChar: span.end, type: "yellow", note: "" });
          }
        } else { w = normWord(raw); ctx = sentenceContaining(p.target, raw); }
        if (w && w.length >= 2) {
          let term = findTerm(w);
          if (!term) { term = { id: uid(), word: w, definitions: [], encounters: [] }; state.terms.push(term); }
          let enc = term.encounters.find((x) => x.entryId === e.id && (!span || Math.abs(x.charStart - span.start) < 2));
          if (!enc) { enc = { entryId: e.id, date: e.date, context: ctx, note: "", charStart: span ? span.start : 0, charEnd: span ? span.end : 0 }; term.encounters.push(enc); }
          else if (ctx) enc.context = ctx;
          if (note && !term.definitions.some((d) => String(d).trim() === note)) term.definitions.push(note);
          words++;
        }
      } else {
        const lc = raw.toLowerCase();
        let th = p.threads.find((t) => t.anchorText && t.anchorText.trim().toLowerCase() === lc);
        if (!th) {
          const i = p.target.toLowerCase().indexOf(lc);
          th = normThread({ anchorChar: i >= 0 ? i : null, anchorText: i >= 0 ? p.target.slice(i, i + raw.length) : raw, fromInterp: true });
          p.threads.push(th);
        }
        if (note && !th.messages.some((m) => m.role === "assistant" && String(m.content).trim() === note)) {
          th.messages.push({ id: uid(), role: "assistant", content: note, timestamp: nowISO() });
        }
        phrases++;
      }
    }
    rebuildTermIndex();
    touchEntry(e); touchAppState();
    return { words, phrases };
  }
  function askClaudeAboutRev(e, p, s, e2) {
    const anchorText = p.target.slice(s, e2).trim();
    const th = normThread({ anchorChar: s, anchorText });
    p.threads.push(th);
    touchEntry(e);
    try { window.getSelection().removeAllRanges(); } catch (_) {}
    renderReverseEntry();
    const q = prompt(`“${anchorText}”\n\n무엇이 궁금한가요?`, "");
    if (q == null || !q.trim()) return;
    runRevClaude(e, p, th, q.trim());
  }
  async function sendRevInterp() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const p = reverseOf(e);
    const ta = $("revInterpInput"); if (!ta) return;
    p.interpretation = ta.value;
    const text = p.interpretation.trim();
    if (!text) { ta.focus(); toast("먼저 해석이나 질문을 적어 주세요"); return; }
    let th = p.threads.find((t) => t.fromInterp && !t.anchorText);
    if (!th) { th = normThread({ fromInterp: true }); p.threads.push(th); }
    const lastUser = [...th.messages].reverse().find((m) => !m.pending && m.role === "user");
    if (lastUser && lastUser.content.trim() === text) { toast("바뀐 내용이 없습니다"); return; }
    await runRevClaude(e, p, th, text, { extract: true });
  }
  function deleteRevThread(id) {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const p = reverseOf(e);
    if (!confirm("이 대화를 삭제할까요?")) return;
    p.threads = p.threads.filter((t) => t.id !== id);
    touchEntry(e);
    renderReverseEntry(); renderSidebarCounts();
  }

  function shownAttempt() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return null;
    return reverseOf(e).attempts.find((a) => a.id === revShownAttemptId) || null;
  }
  function fileAnalysisPatterns() {
    const e = currentEntry(); if (!e || e.kind !== "reverse") return;
    const at = shownAttempt();
    if (!at || !at.analysis) return;
    const picked = [...D.revCompare.querySelectorAll("input[data-rev-diff]")]
      .filter((c) => c.checked)
      .map((c) => at.analysis.diffs[+c.dataset.revDiff])
      .filter(Boolean);
    if (!picked.length) { toast("담을 항목을 골라 주세요"); return; }
    let added = 0, bumped = 0;
    for (const d of picked) { if (filePattern(d, e.id) === "new") added++; else bumped++; }
    touchAppState();
    renderReverseCompare(e, at);
    renderSidebarCounts();
    const parts = [];
    if (added) parts.push(`${added}개 담음`);
    if (bumped) parts.push(`${bumped}개는 반복 — 횟수 올림`);
    toast("나의 패턴 · " + parts.join(" · "));
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
  // Flat renderer: one continuous string with \n preserved by `white-space: pre-wrap`.
  // Keeping it flat means #bodyRender's text content === e.body exactly (thread-anchor
  // <sup>s are empty, their △ comes from CSS), so drag-select offsets map cleanly.
  function buildBodyHtml(e, opts) {
    opts = opts || {};
    const text = e.body;
    if (!text) return "";
    const hls = [...(e.highlights || [])]
      .map((h) => ({ ...h, startChar: clamp(h.startChar, 0, text.length), endChar: clamp(h.endChar, 0, text.length) }))
      .filter((h) => h.endChar > h.startChar)
      .sort((a, b) => a.startChar - b.startChar);
    const clean = []; let last = -1;
    for (const h of hls) { if (h.startChar >= last) { clean.push(h); last = h.endChar; } }
    const events = [];
    for (const h of clean) {
      events.push({ pos: h.startChar, k: 2, hl: h });
      events.push({ pos: h.endChar,   k: 0, hl: h });
    }
    for (const t of (e.threads || [])) {
      if (Number.isFinite(t.anchorChar)) events.push({ pos: clamp(t.anchorChar, 0, text.length), k: 1, thread: t });
    }
    events.sort((a, b) => a.pos - b.pos || a.k - b.k);
    let html = "", cur = 0, inHl = null;
    for (const x of events) {
      const seg = text.slice(cur, x.pos);
      html += inHl ? esc(seg) : termWrap(seg);
      cur = x.pos;
      if (x.k === 2)      { inHl = x.hl; html += `<mark${markAttrs(x.hl, e)}>`; }
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
    const e = currentEntry();
    if (!e || e.kind !== "transcription") return; // 사유·역번역 have no interpretation field
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
    claudeBusy = true; aiBusy++;
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
    claudeBusy = false; aiBusy = Math.max(0, aiBusy - 1);
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
  function recentItemHtml(e, today) {
    const dot = e.date === today ? '<span class="recent-dot"></span>' : "";
    const lbl = srcLabel(e) || "제목 없음";
    const stage = e.kind === "reverse"
      ? `<span class="recent-stage stage-${revEntryStage(e)}">${esc(REV_STAGE_LABEL[revEntryStage(e)])}</span>` : "";
    return `<li><button type="button" class="recent-item${e.id === currentId && parseHash().name === "daily" ? " is-active" : ""}" data-id="${escAttr(e.id)}">
      <span class="recent-item-date">${dot}${esc(fmtMD(e.date))}${stage}</span>
      <span class="recent-item-src">${esc(lbl)}</span>
    </button></li>`;
  }
  function renderRecentList() {
    const items = orderedEntries();
    if (!items.length) { D.recentList.innerHTML = '<li class="recent-empty">아직 없습니다</li>'; renderRevisitList(); return; }
    const today = todayISO();
    D.recentList.innerHTML = items.map((e) => recentItemHtml(e, today)).join("");
    renderRevisitList();
  }
  // 오늘 재시도 — only rendered when something is actually due
  function renderRevisitList() {
    const due = state.entries.filter(revIsDue)
      .sort((a, b) => String(revEntryNextRevisit(a)).localeCompare(String(revEntryNextRevisit(b))));
    D.revisitBlock.hidden = !due.length;
    if (!due.length) { D.revisitList.innerHTML = ""; return; }
    const today = todayISO();
    D.revisitList.innerHTML = due.map((e) => recentItemHtml(e, today)).join("");
  }
  function renderSidebarCounts() {
    D.wordsCount.textContent = state.terms.length ? String(state.terms.length) : "";
    let sc = 0;
    const projectKeys = new Set();
    for (const e of state.entries) {
      if (e.kind === "reflection") continue;   // 사유는 더 이상 화면에 나오지 않습니다
      projectKeys.add(projectKey(e));
    }
    for (const { thread } of allThreads()) if (thread.anchorText && thread.messages.length) sc++;
    const pc = Array.isArray(state.patterns) ? state.patterns.length : 0;
    D.sentencesCount.textContent = sc ? String(sc) : "";
    D.patternsCount.textContent = pc ? String(pc) : "";
    { const kn = (Array.isArray(window.PILSA_KITS) ? window.PILSA_KITS : []).length;
      D.libraryCount.textContent = kn ? String(kn) : ""; }
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
    for (const { entry, thread } of allThreads()) {
      if (!thread.anchorText || !thread.messages.length) continue;
      out.push({ entry, thread, text: thread.anchorText, date: entry.date, createdAt: thread.createdAt });
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
      if (e.kind === "reflection") continue;
      const key = projectKey(e);
      let p = map.get(key);
      if (!p) {
        const [a, t] = key.split("|");
        p = { key, author: a, title: t, entries: [], lastUpdated: 0, transcriptionCount: 0, reverseCount: 0, speechCount: 0 };
        map.set(key, p);
      }
      p.entries.push(e);
      const u = +new Date(e.updatedAt || e.createdAt || 0);
      if (u > p.lastUpdated) p.lastUpdated = u;
      if (e.kind === "reverse") p.reverseCount++;
      else if (e.kind === "speech") p.speechCount++;
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
      let t;
      if (e.kind === "reverse") {
        const ps = (e.reverse && e.reverse.passages) || [];
        t = (ps.find((x) => (x.koSource || "").trim()) || {}).koSource || "";  // never the target
      } else t = e.body;
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
    else if (projectsState.kind === "reverse") list = list.filter((p) => p.reverseCount > 0);
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
          ${p.reverseCount ? `<span class="dot-sep">·</span><span>역번역 ${p.reverseCount}</span>` : ""}
          ${p.speechCount ? `<span class="dot-sep">·</span><span>발표 ${p.speechCount}</span>` : ""}
          ${ago ? `<span class="dot-sep">·</span><span>${esc(ago)} 업데이트됨</span>` : ""}
        </div>
      </button>`;
    }).join("");
  }
  // 필사는 작품(아카이브)으로, 역번역은 공부의 산출물(오답노트)로 — 문서 종류마다 어울리는 장르로 정리된다.
  let projectDetailTab = "archive";
  function renderProjectDetailView(slugRaw) {
    let key;
    try { key = decodeURIComponent(slugRaw || ""); } catch (_) { key = slugRaw || ""; }
    const all = getProjects();
    const p = all.find((x) => x.key === key);
    if (!p) {
      D.projectDetailTabs.hidden = true;
      D.projectDetailView.classList.add("art-view");
      D.projectDetailView.classList.remove("is-notebook");
      D.projectCuratorEditBtn.hidden = false;
      D.projectArtScroll.innerHTML = `<div class="art-empty">— 이 프로젝트가 없습니다. 엔트리가 모두 삭제되었거나 출처가 바뀌었습니다. —</div>`;
      return;
    }
    // The notebook tab is always reachable when there's an archive side too —
    // a 필사-only project still needs somewhere to start a 발표 연습 from.
    const hasT = p.transcriptionCount > 0;
    const tab = hasT ? projectDetailTab : "notebook";
    D.projectDetailTabs.hidden = !hasT;
    D.projectDetailTabs.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
    // 오답노트 is a study page, not part of the Cha piece — drop the art skin there
    D.projectDetailView.classList.toggle("art-view", tab !== "notebook");
    D.projectDetailView.classList.toggle("is-notebook", tab === "notebook");
    D.projectCuratorEditBtn.hidden = tab === "notebook";
    if (tab === "notebook") renderProjectNotebook(p, D.projectArtScroll);
    else renderProjectArchive(p, D.projectArtScroll);
  }
  function renderProjectArchive(p, to) {
    const unpub = new Set(state.settings.unpublishedIds || []);
    // 역번역 is a drill, not a piece of writing — it never enters the archive
    const list = p.entries.filter((e) => e.kind !== "reverse" && e.kind !== "reflection").sort((a, b) =>
      a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const title = projectTitle(p);
    const ago = humanAgo(p.lastUpdated);
    const meta = `${list.length}개` +
      (p.transcriptionCount ? ` · 필사 ${p.transcriptionCount}` : "") +
      (p.reverseCount ? ` · 역번역 ${p.reverseCount} (오답노트)` : "") +
      (ago ? ` · ${ago} 업데이트됨` : "");
    let html = `<div class="art-frontis">
      <div class="ft-mark">${esc(title)}</div>
      <div class="ft-en">${esc(meta)}</div>
      ${state.settings.curatorNote ? `<div class="ft-curator">${esc(state.settings.curatorNote)}</div>` : ""}
      <div class="ft-rule"></div>
    </div>`;
    if (!list.length) {
      html += `<div class="art-empty">${p.reverseCount ? "— 역번역은 오답노트 탭에 정리됩니다 —" : "— 아직 비어 있습니다 —"}</div>`;
      to.innerHTML = html; return;
    }
    list.forEach((e, idx) => {
      const isUn = unpub.has(e.id);
      const num = list.length <= 600 ? toRoman(idx + 1) : String(idx + 1);
      let body, interp = "", corr = "", threads = "";
      {
        body = buildArtBody(e);
        if (e.interpretation && e.interpretation.trim()) interp = `<div class="art-interp">${esc(e.interpretation)}</div>`;
        corr = (e.corrections || []).map((c) =>
          `<div class="art-correction"><span class="ts">${esc(fmtDate(c.timestamp))}</span><del>${esc(c.previousText) || "&nbsp;"}</del></div>`).join("");
        threads = (e.threads || []).filter((t) => t.anchorText && t.messages.some((m) => m.role === "assistant")).map((t) => {
          const a = t.messages.find((m) => m.role === "assistant" && !m.pending);
          return `<div class="art-thread"><span class="tri">△</span> <span class="q">${esc(t.anchorText)}</span>${a ? ` — <span class="a">${esc(a.content)}</span>` : ""}</div>`;
        }).join("");
      }
      const foot = `<div class="art-foot"><span class="fn-mark">—— </span>${esc([e.source.author, e.source.title].filter(Boolean).join(", "))}${e.source.page ? ", " + esc(pageRef(e.source.page)) : ""}${e.source.author || e.source.title ? ". " : ""}${esc(fmtDate(e.date))}</div>`;
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

  /* 오답노트 — the study counterpart of the art archive: everything this project's
     역번역 drills say I got wrong, deduped the same way 나의 패턴 dedupes (patKey),
     so a repeated divergence reads as a count, not as noise. */
  function projectRevDigest(p) {
    const revs = p.entries.filter((e) => e.kind === "reverse").sort((a, b) =>
      a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const agg = new Map();
    let attemptCount = 0, passageCount = 0;
    for (const e of revs) {
      for (const ps of (e.reverse && e.reverse.passages) || []) {
        if (!(ps.koSource || "").trim() && !ps.attempts.length) continue;
        passageCount++;
        for (const a of ps.attempts) {
          attemptCount++;
          if (!a.analysis) continue;
          for (const d of a.analysis.diffs) {
            const k = patKey(d.mine, d.targetFrag);
            let row = agg.get(k);
            if (!row) agg.set(k, row = { mine: d.mine, targetFrag: d.targetFrag, category: d.category, note: d.note, count: 0, last: "" });
            row.count++;
            if (a.timestamp > row.last) { row.last = a.timestamp; if (d.note) row.note = d.note; }
          }
        }
      }
    }
    const diffs = [...agg.values()];
    diffs.sort((a, b) => b.count - a.count || String(b.last).localeCompare(String(a.last)));
    return { revs, diffs, attemptCount, passageCount };
  }
  function renderProjectNotebook(p, to) {
    const { revs, diffs, attemptCount, passageCount } = projectRevDigest(p);
    const catCount = {};
    for (const c of REV_CATEGORIES) catCount[c] = 0;
    for (const d of diffs) catCount[d.category] = (catCount[d.category] || 0) + d.count;

    const speeches = p.entries.filter((e) => e.kind === "speech").sort((a, b) =>
      b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));

    let html = `<div class="nb">
      <header class="nb-head">
        <div class="nb-title-row">
          <h1 class="nb-title">${esc(projectTitle(p))} — 오답노트</h1>
          <button type="button" class="rev-btn rev-btn--primary nb-speech-btn" data-speech-new="${escAttr(p.key)}">발표 연습</button>
        </div>
        <p class="nb-sub">역번역 ${revs.length}개 · 문단 ${passageCount} · 시도 ${attemptCount}회 · 갈림 ${diffs.length}종${speeches.length ? ` · 발표 ${speeches.length}회` : ""}</p>
        ${diffs.length ? `<div class="pat-cats nb-cats">${REV_CATEGORIES.map((c) => catCount[c]
          ? `<span class="pat-cat nb-cat cat-${c} is-on">${esc(REV_CAT_LABEL[c])}<span class="pat-cat-n">${catCount[c]}회</span></span>` : "").join("")}</div>` : ""}
      </header>`;

    if (!revs.length && !speeches.length) {
      html += `<div class="list-empty">아직 이 프로젝트의 공부 기록이 없습니다.<br/>역번역 문서를 제출하면 갈림이 모이고, <b>발표 연습</b>으로 말하기 기록을 시작할 수 있습니다.</div></div>`;
      to.innerHTML = html; return;
    }

    if (diffs.length) {
      html += `<div class="nb-h">반복 실수 — 많이 갈린 순</div><div class="nb-list">`;
      for (const d of diffs) {
        const filed = findPattern(patKey(d.mine, d.targetFrag));
        html += `<div class="nb-row${filed && filed.starred ? " is-starred" : ""}">
          <div class="pattern-row-top">
            ${revCatBadge(d.category)}
            ${d.count > 1 ? `<span class="pattern-hits">${d.count}회 갈림</span>` : ""}
            ${filed ? `<span class="rev-diff-filed">나의 패턴에 담김${filed.starred ? " ★" : ""}</span>` : ""}
          </div>
          <div class="rev-diff-pair">
            <div class="rev-sent-row"><span class="rev-diff-lbl">내</span><span class="rev-frag rev-x">${esc(d.mine) || "—"}</span></div>
            <div class="rev-sent-row"><span class="rev-diff-lbl">목표</span><span class="rev-frag rev-o">${esc(d.targetFrag) || "—"}</span></div>
          </div>
          ${d.note ? `<div class="pattern-note">${esc(d.note)}</div>` : ""}
        </div>`;
      }
      html += `</div>`;
    } else if (revs.length) {
      html += `<div class="list-empty">아직 분석된 시도가 없습니다. 역번역 문단을 제출하면 갈림이 여기 모입니다.</div>`;
    }

    if (passageCount) {
      html += `<div class="nb-h">문단별 요점</div>`;
      for (const e of revs) {
        const label = [e.source.page, fmtDate(e.date)].filter(Boolean).join(" · ");
        html += `<section class="nb-doc">
          <div class="nb-doc-head">
            <span class="nb-doc-title">${esc(label || e.date)}</span>
            <button type="button" class="pattern-open" data-open-entry="${escAttr(e.id)}">열기 →</button>
          </div>`;
        for (const ps of (e.reverse && e.reverse.passages) || []) {
          if (!(ps.koSource || "").trim() && !ps.attempts.length) continue;
          const latest = [...ps.attempts].reverse().find((a) => a.analysis) || null;
          const due = ps.nextRevisit && ps.nextRevisit <= todayISO() && ps.stage !== "done";
          html += `<div class="nb-pass">
            <div class="nb-ko">${esc((ps.koSource || "").trim().slice(0, 180))}</div>
            <div class="nb-pass-meta">
              <span class="rev-stage-badge${ps.stage === "done" ? " stage-done" : ""}${due ? " is-due" : ""}">${esc(REV_STAGE_LABEL[ps.stage] || ps.stage)}</span>
              <span>시도 ${ps.attempts.length}회</span>
              ${ps.nextRevisit && ps.stage !== "done" ? `<span>다음 재시도 ${esc(fmtDate(ps.nextRevisit))}</span>` : ""}
            </div>
            ${latest && latest.analysis.verdict ? `<div class="nb-verdict">${esc(latest.analysis.verdict)}</div>` : ""}
            ${latest && latest.analysis.better.length ? `<div class="nb-better">${latest.analysis.better.slice(0, 2).map((b) =>
              `<div class="nb-better-row"><span class="tri">△</span>${esc(b)}</div>`).join("")}</div>` : ""}
          </div>`;
        }
        html += `</section>`;
      }
    }

    if (speeches.length) {
      html += `<div class="nb-h" id="nbSpeechSection">발표 기록</div>`;
      for (const e of speeches) html += speechCardHtml(e);
    }
    html += `</div>`;
    to.innerHTML = html;
  }

  // One 발표 record: date · duration · keywords · transcript (folded) · Claude's
  // review — what the run missed, and spoken wordings with better alternatives.
  function speechCardHtml(e) {
    const sp = e.speech || normSpeech({});
    const an = sp.analysis;
    const busy = speechBusyIds.has(e.id);
    const m = Math.floor(sp.durationSec / 60), s = sp.durationSec % 60;
    const dur = sp.durationSec ? `${m ? m + "분 " : ""}${s}초` : "";
    let body = "";
    if (an) {
      if (an.verdict) body += `<div class="nb-verdict">${esc(an.verdict)}</div>`;
      if (an.missed.length) body += `<div class="nb-missed">
        <div class="nb-missed-h">요점에서 빠지거나 어긋난 것</div>
        <ul>${an.missed.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>`;
      if (an.diffs.length) body += `<div class="nb-sp-diffs">` + an.diffs.map((d, i) => {
        const filed = findPattern(patKey(d.mine, d.targetFrag));
        return `<div class="nb-row">
          <div class="pattern-row-top">
            ${revCatBadge(d.category)}
            ${filed
              ? `<span class="rev-diff-filed">담김 · ${filed.hits}회</span>`
              : `<button type="button" class="pattern-open nb-sp-file" data-speech-file="${escAttr(e.id)}" data-diff-i="${i}">담기</button>`}
          </div>
          <div class="rev-diff-pair">
            <div class="rev-sent-row"><span class="rev-diff-lbl">말한</span><span class="rev-frag rev-x">${esc(d.mine) || "—"}</span></div>
            <div class="rev-sent-row"><span class="rev-diff-lbl">나은</span><span class="rev-frag rev-o">${esc(d.targetFrag) || "—"}</span></div>
          </div>
          ${d.note ? `<div class="pattern-note">${esc(d.note)}</div>` : ""}
        </div>`;
      }).join("") + `</div>`;
      if (!an.missed.length && !an.diffs.length && !an.verdict) body += `<div class="nb-verdict">분석이 비어 있습니다.</div>`;
    } else if (busy) {
      body += `<div class="nb-sp-busy">△ Claude 분석 중…</div>`;
    } else {
      body += `<div class="nb-sp-busy">분석이 없습니다.
        <button type="button" class="pattern-open" data-speech-retry="${escAttr(e.id)}">분석 요청</button></div>`;
    }
    return `<section class="nb-doc nb-speech" data-speech="${escAttr(e.id)}">
      <div class="nb-doc-head">
        <span class="nb-doc-title">${esc(fmtDate(e.date))}${dur ? ` · ${dur}` : ""}</span>
        <button type="button" class="pattern-del" data-speech-del="${escAttr(e.id)}" title="이 발표 기록 삭제">삭제</button>
      </div>
      ${sp.keywords.length ? `<div class="nb-kws">${sp.keywords.map((k) => `<span class="nb-kw">${esc(k)}</span>`).join("")}</div>` : ""}
      ${sp.transcript ? `<details class="nb-sp-tr"><summary>전사본</summary><div class="nb-sp-text">${esc(sp.transcript)}</div></details>` : ""}
      ${body}
    </section>`;
  }

  /* ── 발표 연습: record (app stays silent) → hand-correct the transcript → Claude reviews
     it against this project's sources. Audio is discarded; only the transcript is kept. ── */
  const speechBusyIds = new Set();
  let speechRec = null, speechRecWanted = false, speechTimer = null;
  function stopSpeechRec() {
    speechRecWanted = false;
    if (speechRec) { try { speechRec.stop(); } catch (_) {} speechRec = null; }
    if (speechTimer) { clearInterval(speechTimer); speechTimer = null; }
  }
  function openSpeechPractice(p) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const wrap = document.createElement("div");
    wrap.className = "sp";
    wrap.innerHTML = `
      <div class="sp-step" data-step="prep">
        <p class="sp-hint">키워드 5~7개만 메모하고, 대본 없이 말합니다. 녹음 중에 앱은 아무것도 보여주지 않습니다 — 끝나면 전사본이 열리고, 그때 고칠 수 있습니다.</p>
        <input class="new-project-input sp-keywords" placeholder="키워드 (쉼표로 구분 · 선택)" />
        ${SR ? "" : `<p class="sp-warn">이 브라우저는 음성 인식(Web Speech API)을 지원하지 않습니다 — Chrome에서 열거나, 따로 녹음해 듣고 다음 단계에서 직접 옮겨 적으세요.</p>`}
        <div class="rev-foot"><button type="button" class="rev-btn rev-btn--primary sp-start">${SR ? "녹음 시작" : "직접 옮겨 적기"}</button></div>
      </div>
      <div class="sp-step" data-step="rec" hidden>
        <div class="sp-rec"><span class="sp-dot"></span><span class="sp-time">0:00</span></div>
        <p class="sp-hint sp-hint--center">말하는 동안 화면은 이대로 있습니다.</p>
        <div class="rev-foot"><button type="button" class="rev-btn rev-btn--primary sp-stop">정지</button></div>
      </div>
      <div class="sp-step" data-step="edit" hidden>
        <div class="rev-h">전사본 — 실제로 말한 대로 고치기</div>
        <textarea class="rev-setup-input sp-transcript" spellcheck="false" placeholder="여기 전사본이 들어옵니다. 인식이 뭉갠 부분을 실제로 말한 대로 고친 뒤 제출하세요."></textarea>
        <div class="rev-foot">
          <button type="button" class="rev-btn rev-btn--primary sp-submit">분석 요청</button>
          <span class="rev-meta sp-meta"></span>
        </div>
      </div>`;
    const q = (sel) => wrap.querySelector(sel);
    const show = (name) => wrap.querySelectorAll(".sp-step").forEach((el) => (el.hidden = el.dataset.step !== name));
    let t0 = 0, durationSec = 0, raw = "";
    const finals = [];
    q(".sp-start").addEventListener("click", () => {
      if (!SR) { show("edit"); q(".sp-transcript").focus(); return; }
      finals.length = 0;
      speechRec = new SR();
      speechRec.lang = "en-US";
      speechRec.continuous = true;
      speechRec.interimResults = false;
      speechRec.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++)
          if (ev.results[i].isFinal) finals.push(ev.results[i][0].transcript.trim());
      };
      // Chrome stops the recognizer after a pause — keep it alive until 정지 is pressed
      speechRec.onend = () => { if (speechRecWanted && speechRec) { try { speechRec.start(); } catch (_) {} } };
      speechRec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          toast("마이크 권한이 없습니다 — 브라우저 설정에서 허용해 주세요");
          stopSpeechRec(); show("edit"); q(".sp-transcript").focus();
        }
      };
      speechRecWanted = true;
      try { speechRec.start(); } catch (_) {}
      t0 = Date.now();
      const timeEl = q(".sp-time");
      speechTimer = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }, 500);
      show("rec");
    });
    q(".sp-stop").addEventListener("click", () => {
      durationSec = Math.max(1, Math.round((Date.now() - t0) / 1000));
      stopSpeechRec();
      // final recognition results can trail the stop by a moment — give them a beat to land
      setTimeout(() => {
        raw = finals.join(" ").replace(/\s+/g, " ").trim();
        const ta = q(".sp-transcript");
        ta.value = raw;
        q(".sp-meta").textContent = `${Math.floor(durationSec / 60)}분 ${durationSec % 60}초 · 인식된 그대로 — 고친 뒤 제출`;
        show("edit"); ta.focus();
      }, 400);
    });
    q(".sp-submit").addEventListener("click", () => {
      const text = q(".sp-transcript").value.trim();
      if (!text) { toast("전사본이 비어 있습니다"); return; }
      const e = blankEntry("speech");
      e.source = { author: p.author || "", title: p.title || "", page: "" };
      e.speech.keywords = q(".sp-keywords").value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
      e.speech.durationSec = durationSec;
      e.speech.rawTranscript = raw;
      e.speech.transcript = text;
      state.entries.push(e);
      touchEntry(e);
      closeModal();
      projectDetailTab = "notebook";
      const { name, arg } = parseHash();
      if (name === "projects" && arg && arg.length) renderProjectDetailView(arg[0]);
      runSpeechAnalysis(e);
    });
    openModal("발표 연습 — " + projectTitle(p), wrap);
    setTimeout(() => q(".sp-keywords").focus(), 0);
  }

  async function runSpeechAnalysis(e) {
    const sp = e.speech;
    if (!sp || !sp.transcript.trim()) return;
    speechBusyIds.add(e.id);
    aiBusy++; // keep the auto-pull from swapping state.entries mid-call
    rerenderOpenNotebook(e);
    try {
      const { data: sess } = await sb.auth.getSession();
      const tok = sess && sess.session ? sess.session.access_token : null;
      if (!tok) throw new Error("로그인이 필요합니다");
      const p = getProjects().find((x) => x.key === projectKey(e));
      // source material the talk is judged against: 역번역 targets + 필사 bodies
      const sources = [];
      if (p) {
        for (const x of p.entries) {
          if (x.kind === "reverse") { for (const ps of (x.reverse && x.reverse.passages) || []) if ((ps.target || "").trim()) sources.push(ps.target.trim()); }
          else if (x.kind === "transcription") { for (const ps of x.passages || []) if ((ps.body || "").trim()) sources.push(ps.body.trim()); }
        }
      }
      let budget = 9000;
      const capped = [];
      for (const s of sources) { if (budget <= 0) break; capped.push(s.slice(0, budget)); budget -= s.length; }
      const patterns = (p ? projectRevDigest(p).diffs : []).slice(0, 8)
        .map((d) => ({ mine: d.mine, targetFrag: d.targetFrag, category: d.category }));
      const resp = await fetch(CLAUDE_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          speech: true,
          transcript: sp.transcript, keywords: sp.keywords,
          sources: capped, patterns,
          context: { author: e.source.author || "", title: e.source.title || "" },
        }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || out.error) throw new Error((out && out.error) ? out.error : `요청 실패 (${resp.status})`);
      sp.analysis = normSpeechAnalysis(out.speech || {});
      touchEntry(e);
      toast("발표 분석 완료");
    } catch (err) {
      toast("Claude 호출 실패 — " + (err.message || String(err)));
    } finally {
      speechBusyIds.delete(e.id);
      aiBusy = Math.max(0, aiBusy - 1);
      rerenderOpenNotebook(e);
    }
  }
  function rerenderOpenNotebook(e) {
    const { name, arg } = parseHash();
    if (name === "projects" && arg && arg.length && arg[0] === projectKey(e) && projectDetailTab === "notebook")
      renderProjectDetailView(arg[0]);
  }

  function openNewProjectModal() {
    const wrap = document.createElement("div");
    wrap.className = "new-project-form";
    wrap.innerHTML = `
      <div class="new-project-fields">
        <span class="new-project-label">저자</span>
        <input class="new-project-input" id="npAuthor" placeholder="예: 톨스토이" autocomplete="off" list="authorList" />
        <span class="new-project-label" style="margin-top:4px;">작품 · 주제</span>
        <input class="new-project-input" id="npTitle" placeholder="예: 예술이란 무엇인가" autocomplete="off" list="titleList" />
      </div>
      <div class="new-project-label" style="margin-top:6px;">첫 문서</div>
      <div class="new-project-pickers">
        <button type="button" class="doc-picker-card" data-kind="transcription">
          <span class="doc-picker-name">필사</span>
          <span class="doc-picker-desc">남의 글을 옮겨 적고 해석합니다.</span>
        </button>
        <button type="button" class="doc-picker-card" data-kind="reverse">
          <span class="doc-picker-name">역번역</span>
          <span class="doc-picker-desc">내 한국어에서 영어를 다시 만듭니다.</span>
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
    refreshSourceDatalists();
    setTimeout(() => { try { wrap.querySelector("#npAuthor").focus(); } catch (_) {} }, 0);
  }

  /* ─────────────────────── 서가 (library) ─────────────────────── */
  const kits = () => (Array.isArray(window.PILSA_KITS) ? window.PILSA_KITS : []);
  const kitTaken = (id) => (state.settings.kitsTaken || []).includes(id);
  function renderLibraryView() {
    const all = kits();
    D.librarySub.textContent = all.length
      ? `${all.length}개의 꾸러미 · 가져오면 내 문서가 되어, 고치고 지울 수 있습니다`
      : "아직 꾸러미가 없습니다.";
    D.kitGrid.innerHTML = all.map((k) => {
      const n = (k.items || []).length;
      const taken = kitTaken(k.id);
      return `<div class="kit-card${taken ? " is-taken" : ""}">
        <div class="kit-card-top">
          <span class="kit-kind kit-kind--${esc(k.kind)}">${k.kind === "reverse" ? "역번역" : "필사"}</span>
          ${k.tag ? `<span class="kit-tag">${esc(k.tag)}</span>` : ""}
          ${taken ? `<span class="kit-taken">가져옴</span>` : ""}
        </div>
        <div class="kit-title">${esc(k.title)}</div>
        <div class="kit-blurb">${esc(k.blurb || "")}</div>
        <div class="kit-foot">
          <span class="kit-count">${n}문단</span>
          ${k.note ? `<span class="kit-note">${esc(k.note)}</span>` : ""}
          <button type="button" class="rev-btn rev-btn--primary kit-take" data-kit="${escAttr(k.id)}">${taken ? "다시 가져오기" : "가져오기"}</button>
        </div>
      </div>`;
    }).join("");
  }
  function takeKit(id) {
    const k = kits().find((x) => x.id === id);
    if (!k || !Array.isArray(k.items) || !k.items.length) return;
    if (kitTaken(k.id) && !confirm(`「${k.title}」은 이미 가져왔습니다.\n같은 내용으로 새 문서를 하나 더 만들까요?`)) return;

    const e = blankEntry(k.kind);
    if (k.source) {
      e.source.author = k.source.author || "";
      e.source.title = k.source.title || "";
      e.source.page = k.source.page || "";
    }
    if (k.kind === "reverse") {
      e.reverse = { passages: k.items.map((it) => normRevPassage({ koSource: it.ko || "", target: it.en || "" })) };
    } else {
      e.passages = k.items.map((it) => normPassage({ body: it.body || it.en || "" }));
      const p0 = e.passages[0];
      e.body = p0.body; e.highlights = p0.highlights; e.interpretation = p0.interpretation;
      e.corrections = p0.corrections; e.threads = p0.threads;
    }
    state.entries.push(e);
    const taken = new Set(state.settings.kitsTaken || []);
    taken.add(k.id);
    state.settings.kitsTaken = [...taken];
    touchAppState();

    currentId = e.id; revPassageId = null; revModeId = null; currentPassageId = null;
    touchEntry(e); rememberOpen();
    renderRecentList(); renderSidebarCounts();
    toast(`「${k.title}」 ${k.items.length}문단을 가져왔습니다`);
    go("#daily");
  }

  /* ─────────────────────── 나의 패턴 (pattern note) ─────────────────────── */
  let patternsState = { filter: "", cat: "all", star: "all" };
  function renderPatternsView() {
    if (!Array.isArray(state.patterns)) state.patterns = [];
    const all = state.patterns;
    D.patternsSub.textContent = `${all.length}개의 패턴 · 역번역 대조에서 담은 것들 — 같은 갈림이 반복되면 횟수가 올라갑니다`;
    D.patternsFilter.value = patternsState.filter;
    D.patternsStarFilter.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.star === patternsState.star));

    const counts = {};
    for (const c of REV_CATEGORIES) counts[c] = 0;
    for (const p of all) counts[p.category] = (counts[p.category] || 0) + p.hits;
    D.patternsCats.innerHTML =
      `<button type="button" class="pat-cat${patternsState.cat === "all" ? " is-on" : ""}" data-cat="all">전체<span class="pat-cat-n">${all.length}</span></button>` +
      REV_CATEGORIES.map((c) => {
        const n = all.filter((p) => p.category === c).length;
        return `<button type="button" class="pat-cat cat-${c}${patternsState.cat === c ? " is-on" : ""}" data-cat="${c}">${esc(REV_CAT_LABEL[c])}<span class="pat-cat-n">${n}${counts[c] > n ? ` · ${counts[c]}회` : ""}</span></button>`;
      }).join("");

    const f = patternsState.filter.trim().toLowerCase();
    let list = all.slice();
    if (patternsState.cat !== "all") list = list.filter((p) => p.category === patternsState.cat);
    if (patternsState.star === "starred") list = list.filter((p) => p.starred);
    if (f) list = list.filter((p) => (p.mine + " " + p.targetFrag + " " + p.note).toLowerCase().includes(f));
    list.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.hits - a.hits || String(b.createdAt).localeCompare(String(a.createdAt)));

    if (!list.length) {
      D.patternList.innerHTML = `<div class="list-empty">${all.length ? "거른 결과가 없습니다." : "아직 담은 패턴이 없습니다. 역번역 문서를 제출하고, 대조 분석에서 “분석을 패턴 노트에 담기”를 누르면 여기 모입니다."}</div>`;
      return;
    }
    D.patternList.innerHTML = list.map((p) => {
      const src = findEntry(p.sourceEntryId);
      return `<div class="pattern-row${p.starred ? " is-starred" : ""}" data-pat="${escAttr(p.id)}">
        <div class="pattern-row-top">
          ${revCatBadge(p.category)}
          ${p.hits > 1 ? `<span class="pattern-hits">${p.hits}회 반복</span>` : ""}
          <button type="button" class="pattern-star" data-pat-star="${escAttr(p.id)}" title="반복 실패 표시">${p.starred ? "★" : "☆"}</button>
          <button type="button" class="pattern-del" data-pat-del="${escAttr(p.id)}" title="이 패턴 지우기">삭제</button>
        </div>
        <div class="rev-diff-pair">
          <div class="rev-sent-row"><span class="rev-diff-lbl">내</span><span class="rev-frag rev-x">${esc(p.mine) || "—"}</span></div>
          <div class="rev-sent-row"><span class="rev-diff-lbl">목표</span><span class="rev-frag rev-o">${esc(p.targetFrag) || "—"}</span></div>
        </div>
        ${p.note ? `<div class="pattern-note">${esc(p.note)}</div>` : ""}
        <div class="pattern-foot">
          <span>${esc(fmtDate(p.createdAt))}</span>
          ${src ? `<button type="button" class="pattern-open" data-open-entry="${escAttr(src.id)}">${esc(srcLabel(src) || "이 역번역")} 열기 →</button>` : ""}
        </div>
      </div>`;
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
      if (e.kind === "reflection" || e.kind === "speech") return false; // 사유·발표는 검색 밖 (발표는 프로젝트 오답노트에서)
      if (searchState.from && e.date < searchState.from) return false;
      if (searchState.to && e.date > searchState.to) return false;
      if (searchState.author && !e.source.author.toLowerCase().includes(searchState.author.toLowerCase())) return false;
      if (e.kind === "reverse") {
        const ps = (e.reverse && e.reverse.passages) || [];
        if (searchState.colors.size && !ps.some((p) => p.highlights.some((h) => searchState.colors.has(h.type)))) return false;
        if (searchState.claude && !ps.some((p) => p.threads.some((t) => t.messages.length))) return false;
        if (!q) return true;
        // koSource, attempts, my reading and △ talk — never the target itself
        const hay = [e.source.author, e.source.title, e.source.page].concat(
          ps.flatMap((p) => [p.koSource || "", p.interpretation || ""]
            .concat(p.attempts.map((a) => a.text))
            .concat(p.threads.flatMap((t) => [t.anchorText].concat(t.messages.map((m) => m.content)))))
        ).join("\n").toLowerCase();
        return hay.includes(ql);
      }
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
      const ql = q.toLowerCase();
      let snip, colors = "", hasC = "", kindTag = "";
      if (e.kind === "reverse") {
        const ps = (e.reverse && e.reverse.passages) || [];
        const fields = ps.flatMap((p) => [p.koSource || "", p.interpretation || ""].concat(p.attempts.map((a) => a.text))); // never the target
        const hit = (q && fields.find((f) => f.toLowerCase().includes(ql))) || (ps[0] && ps[0].koSource) || "";
        snip = snippet(hit, q);
        colors = [...new Set(ps.flatMap((p) => p.highlights.map((h) => h.type)))].map((c) => `<span class="dot ${c === "yellow" ? "dot-y" : "dot-b"}" style="display:inline-block;width:7px;height:7px;border-radius:2px;"></span>`).join(" ");
        hasC = ps.some((p) => p.threads.some((t) => t.messages.length)) ? "△" : "";
        kindTag = `<span class="sr-kind">역번역 · ${esc(REV_STAGE_LABEL[revEntryStage(e)])}${ps.length > 1 ? ` · ${ps.length}문단` : ""}</span>`;
      } else {
        const fields = [e.body, e.interpretation].concat(e.threads.flatMap((t) => t.messages.map((m) => m.content)));
        const hit = (q && fields.find((f) => f.toLowerCase().includes(ql))) || e.body || e.interpretation || "";
        snip = snippet(hit, q);
        colors = [...new Set(e.highlights.map((h) => h.type))].map((c) => `<span class="dot ${c === "yellow" ? "dot-y" : "dot-b"}" style="display:inline-block;width:7px;height:7px;border-radius:2px;"></span>`).join(" ");
        hasC = e.threads.some((t) => t.messages.length) ? "△" : "";
      }
      return `<button type="button" class="sr-item${i === searchState.cursor ? " is-cursor" : ""}" data-id="${escAttr(e.id)}">
        <div class="sr-meta"><span>${esc(fmtDate(e.date))}</span>${colors ? `<span>${colors}</span>` : ""}${hasC ? `<span>${hasC}</span>` : ""}${kindTag}</div>
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

  /* ─────────────────────── 안내 투어 ─────────────────────── */
  // Anchors are looked up lazily: a step whose element isn't on screen right now
  // (the body editor before any entry exists, say) just renders without a spotlight.
  const TOUR = [
    { title: "필사에 오신 것을 환영합니다",
      text: "영어를 손으로 옮겨 적고, 모르는 것을 표시하고, 한국어로 옮겨 보고, 그 자리에서 물어보는 일지입니다.<br/>1분이면 어디에 무엇이 있는지 다 봅니다." },
    { anchor: () => D.newEntryBtn, title: "새 문서 · ⌘N",
      text: "두 종류가 있습니다.<br/><b>필사</b> — 남의 영어를 옮겨 적고 해석합니다.<br/><b>역번역</b> — 내 한국어에서 영어를 다시 만들고, 정답지와 대조합니다." },
    { anchor: () => (D.entryView.hidden ? null : D.bodyField), title: "본문 — 클릭해서 쓰고, 드래그해서 표시",
      text: "본문을 클릭하면 편집이 됩니다. 글자를 드래그하면 작은 막대가 뜹니다.<br/><b>🟡 단어</b> 모르는 단어 · <b>🔵 구절</b> 헷갈리는 구절 · <b>△ 묻기</b> 그 자리에서 Claude에게." },
    { anchor: () => (D.entryView.hidden ? null : D.interpInput), title: "해석 — ⌘↵ 로 보내기",
      text: "한국어로 옮겨 보고, 헷갈리는 건 헷갈린 채로 적어 두세요.<br/><b>⌘↵</b> 를 누르면 Claude가 답하면서, 물어본 단어와 문장을 아래 노트에 자동으로 정리해 둡니다." },
    { anchor: () => D.wordsBtn, title: "나의 단어 · 나의 문장",
      text: "🟡로 표시한 단어가 <b>나의 단어</b>에 쌓입니다. 같은 단어를 나중에 다시 만나면 점선 밑줄이 붙고, 처음 만난 날과 문장을 보여줍니다.<br/>△로 물어본 문장은 <b>나의 문장</b>에 모입니다." },
    { anchor: () => D.patternsBtn, title: "역번역과 나의 패턴",
      text: "역번역은 정답지를 가린 채 영어를 다시 만드는 훈련입니다. 제출하면 나란히 대조하고, 갈린 자리를 네 범주로 분석해 줍니다.<br/>담아 둔 갈림은 <b>나의 패턴</b>에 쌓여 약점 지도가 됩니다. 3일 뒤·2주 뒤에 같은 문단을 다시 씁니다." },
    { anchor: () => D.projectsBtn, title: "프로젝트 — 다시 읽기",
      text: "같은 저자·작품의 기록이 자동으로 한 묶음이 됩니다. 열면 흑백 세리프의 아카이브로, 쓴 것을 작품처럼 다시 읽을 수 있습니다." },
    { anchor: () => D.tourBtn, title: "여기까지입니다",
      text: "이 안내는 언제든 여기서 다시 열 수 있습니다.<br/>이제 <b>새 문서</b>로 한 구절 옮겨 적는 일에서 시작해 보세요." },
  ];
  let tourIdx = 0;
  function tourSeen() { return !!(state.settings && state.settings.tourSeenAt); }
  function markTourSeen() {
    if (!state.settings) return;
    if (state.settings.tourSeenAt) return;
    state.settings.tourSeenAt = nowISO();
    touchAppState();
  }
  function openTour(from) {
    tourIdx = Number.isFinite(from) ? from : 0;
    D.tour.hidden = false;
    renderTourStep();
    window.addEventListener("resize", renderTourStep);
  }
  function closeTour() {
    D.tour.hidden = true;
    D.tourSpot.hidden = true;
    window.removeEventListener("resize", renderTourStep);
    markTourSeen();
  }
  function tourGo(d) {
    const n = tourIdx + d;
    if (n < 0) return;
    if (n >= TOUR.length) { closeTour(); return; }
    tourIdx = n;
    renderTourStep();
  }
  function renderTourStep() {
    if (D.tour.hidden) return;
    const s = TOUR[tourIdx];
    D.tourStep.textContent = `${tourIdx + 1} / ${TOUR.length}`;
    D.tourTitle.textContent = s.title;
    D.tourText.innerHTML = s.text;               // authored above, not user input
    D.tourPrev.hidden = tourIdx === 0;
    D.tourNext.textContent = tourIdx === TOUR.length - 1 ? "시작하기" : "다음";
    D.tourDots.innerHTML = TOUR.map((_, i) => `<span class="tour-dot${i === tourIdx ? " is-on" : ""}"></span>`).join("");

    const el = s.anchor ? s.anchor() : null;
    const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    if (r && r.width && r.height) {
      const pad = 6;
      D.tourSpot.hidden = false;
      D.tourSpot.style.left = (r.left - pad) + "px";
      D.tourSpot.style.top = (r.top - pad) + "px";
      D.tourSpot.style.width = (r.width + pad * 2) + "px";
      D.tourSpot.style.height = (r.height + pad * 2) + "px";
      placeTourCard(r);
    } else {
      D.tourSpot.hidden = true;
      D.tourCard.style.left = ""; D.tourCard.style.top = "";
      D.tourCard.classList.add("is-centered");
    }
  }
  function placeTourCard(r) {
    D.tourCard.classList.remove("is-centered");
    const cw = D.tourCard.offsetWidth || 340, ch = D.tourCard.offsetHeight || 200;
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    let left = r.right + 16;
    if (left + cw > vw - 12) left = r.left - cw - 16;      // flip to the other side
    if (left < 12) left = Math.min(Math.max(12, r.left), vw - cw - 12); // or just fit
    let top = r.top + r.height / 2 - ch / 2;
    top = clamp(top, 12, Math.max(12, vh - ch - 12));
    D.tourCard.style.left = left + "px";
    D.tourCard.style.top = top + "px";
  }

  /* ─────────────────────── AUTH ─────────────────────── */
  let authMode = "signin"; // or "signup"
  function setAuthMode(m) {
    authMode = m === "signup" ? "signup" : "signin";
    const up = authMode === "signup";
    D.authTabs.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === authMode));
    D.authSubmit.textContent = up ? "회원가입" : "로그인";
    // signup gets its own field, so switching tabs visibly produces a different form
    D.authPassword2.hidden = !up;
    D.authPassword2.required = up;
    D.authPassword2.value = "";
    D.authHint.hidden = !up;
    D.authPassword.autocomplete = up ? "new-password" : "current-password";
    D.authPassword.placeholder = up ? "비밀번호 (6자 이상)" : "비밀번호";
    D.authMsg.textContent = ""; D.authMsg.classList.remove("ok");
    D.authNote.textContent = up
      ? "이 기록은 당신의 계정에만 보입니다. 같은 이메일·비밀번호로 다른 기기에서도 이어 쓸 수 있습니다."
      : "";
  }
  async function handleAuthSubmit(ev) {
    ev.preventDefault();
    const email = D.authEmail.value.trim(), pw = D.authPassword.value;
    if (!email || pw.length < 6) { D.authMsg.textContent = "이메일과 6자 이상의 비밀번호를 입력해 주세요."; return; }
    if (authMode === "signup" && D.authPassword2.value !== pw) {
      D.authMsg.textContent = "두 비밀번호가 서로 다릅니다.";
      D.authPassword2.focus();
      return;
    }
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
      D.authMsg.textContent = authErrorKo(err);
    }
    D.authSubmit.disabled = false;
  }
  // Supabase speaks English and only some of it is obvious. Anything we can name,
  // we name in Korean; anything we can't, we show raw rather than swallow.
  function authErrorKo(err) {
    const code = (err && err.code) || "";
    const m = (err && err.message) || String(err);
    if (code === "weak_password" || /at least 6 characters|weak.?password/i.test(m)) return "비밀번호는 6자 이상이어야 합니다.";
    if (code === "user_already_exists" || /already registered|already exists/i.test(m)) return "이미 가입된 이메일입니다 — 위의 “로그인”으로 들어가세요.";
    if (code === "validation_failed" || /validate email address|invalid format/i.test(m)) return "이메일 주소 형식을 확인해 주세요.";
    if (code === "signup_disabled" || /signups? not allowed|disabled/i.test(m)) return "지금은 회원가입이 닫혀 있습니다.";
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || /for security purposes|rate limit/i.test(m)) return "요청이 잦습니다 — 1분쯤 뒤에 다시 시도해 주세요.";
    if (/invalid login/i.test(m)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (/email not confirmed/i.test(m)) return "메일 인증이 아직 완료되지 않았습니다.";
    if (/failed to fetch|networkerror|load failed/i.test(m)) return "서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.";
    return m;
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
    refreshSourceDatalists();
    renderRecentList(); renderSidebarCounts();
    renderRoute();
    applySidebar();
    await pullAll();
    refreshSourceDatalists();
    renderRecentList(); renderSidebarCounts();
    // re-render whatever view is active
    renderRoute();
    // first run: show the tour once the real settings have arrived, so a second
    // device doesn't replay it
    if (!tourSeen()) setTimeout(() => { if (!tourSeen()) openTour(0); }, 400);
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
      currentPassageId = null; revModeId = null; revPassageId = null; revDrafts.clear();
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
    D.authTabs.addEventListener("click", (ev) => {
      const b = ev.target.closest(".auth-tab"); if (!b) return;
      setAuthMode(b.dataset.mode);
      D.authEmail.focus();
    });

    // sidebar nav
    D.newEntryBtn.addEventListener("click", newEntry);
    D.emptyNewBtn.addEventListener("click", newEntry);
    D.sidebarToggle.addEventListener("click", toggleSidebar);
    D.sidebarReopen.addEventListener("click", toggleSidebar);
    D.searchBtn.addEventListener("click", openSearch);
    D.wordsBtn.addEventListener("click", () => go("#words"));
    D.sentencesBtn.addEventListener("click", () => go("#sentences"));
    D.patternsBtn.addEventListener("click", () => go("#patterns"));
    D.libraryBtn.addEventListener("click", () => go("#library"));
    D.kitGrid.addEventListener("click", (ev) => { const b = ev.target.closest("[data-kit]"); if (b) takeKit(b.dataset.kit); });
    D.projectsBtn.addEventListener("click", () => go("#projects"));
    D.exportBtn.addEventListener("click", exportJSON);
    D.importBtn.addEventListener("click", () => D.importInput.click());
    D.importInput.addEventListener("change", () => { importJSON(D.importInput.files && D.importInput.files[0]); D.importInput.value = ""; });
    D.signOutBtn.addEventListener("click", () => { if (confirm("로그아웃할까요?")) signOut(); });

    // 안내 투어
    D.tourBtn.addEventListener("click", () => openTour(0));
    D.tourNext.addEventListener("click", () => tourGo(1));
    D.tourPrev.addEventListener("click", () => tourGo(-1));
    D.tourSkip.addEventListener("click", closeTour);
    D.tour.addEventListener("mousedown", (ev) => { if (ev.target === D.tour) closeTour(); });
    D.recentList.addEventListener("click", (ev) => { const b = ev.target.closest(".recent-item"); if (b) openEntry(b.dataset.id); });
    D.revisitList.addEventListener("click", (ev) => { const b = ev.target.closest(".recent-item"); if (b) { go("#daily"); openEntry(b.dataset.id); } });

    // entry header
    D.deleteEntryBtn.addEventListener("click", deleteCurrentEntry);
    D.addParagraphBtn.addEventListener("click", addPassageToCurrent);

    // passage card clicks (before / after the active editor)
    const onPassagesClick = (ev) => {
      const del = ev.target.closest("[data-passdel]");
      if (del) { ev.stopPropagation(); deletePassage(del.dataset.passdel); return; }
      const card = ev.target.closest(".passage-card");
      if (card) { switchActivePassage(card.dataset.pass); }
    };
    D.passagesBefore.addEventListener("click", onPassagesClick);
    D.passagesAfter.addEventListener("click", onPassagesClick);
    const onPassagesKey = (ev) => {
      const card = ev.target.closest(".passage-card");
      if (!card) return;
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); switchActivePassage(card.dataset.pass); }
    };
    D.passagesBefore.addEventListener("keydown", onPassagesKey);
    D.passagesAfter.addEventListener("keydown", onPassagesKey);
    D.entryDate.addEventListener("change", () => {
      const e = currentEntry(); if (!e) return;
      const v = D.entryDate.value; if (!v) { D.entryDate.value = e.date; return; }
      e.date = v; D.entryWeekday.textContent = weekdayOf(v) ? "· " + weekdayOf(v) : "";
      touchEntry(e); renderRecentList();
    });
    const onSrc = (k, el) => { const e = currentEntry(); if (!e) return; e.source[k] = el.value; touchEntry(e); renderRecentList(); refreshSourceDatalists(); };
    D.srcAuthor.addEventListener("input", () => onSrc("author", D.srcAuthor));
    D.srcTitle.addEventListener("input", () => onSrc("title", D.srcTitle));
    D.srcPage.addEventListener("input", () => onSrc("page", D.srcPage));

    // 역번역 entry — header + setup + write + compare
    D.revDeleteBtn.addEventListener("click", deleteCurrentEntry);
    D.revDate.addEventListener("change", () => {
      const e = currentEntry(); if (!e) return;
      const v = D.revDate.value; if (!v) { D.revDate.value = e.date; return; }
      e.date = v; D.revWeekday.textContent = weekdayOf(v) ? "· " + weekdayOf(v) : "";
      touchEntry(e); renderRecentList();
    });
    const onRevSrc = (k, el) => { const e = currentEntry(); if (!e) return; e.source[k] = el.value; touchEntry(e); renderRecentList(); refreshSourceDatalists(); };
    D.revAuthor.addEventListener("input", () => onRevSrc("author", D.revAuthor));
    D.revTitle.addEventListener("input", () => onRevSrc("title", D.revTitle));
    D.revPage.addEventListener("input", () => onRevSrc("page", D.revPage));

    D.revSetupKo.addEventListener("input", () => autoGrow(D.revSetupKo, 600));
    D.revSetupTarget.addEventListener("input", () => autoGrow(D.revSetupTarget, 600));
    D.revSetupSave.addEventListener("click", saveReverseSetup);
    D.revSetupCancel.addEventListener("click", () => { revMode = "write"; renderReverseEntry(); });
    D.revEditSetup.addEventListener("click", () => {
      if (!confirm("정답지를 다시 열면 이번 시도의 훈련 효과가 줄어듭니다.\n계속할까요?")) return;
      revMode = "setup"; renderReverseEntry();
      setTimeout(() => { try { D.revSetupKo.focus(); } catch (_) {} }, 0);
    });

    // the attempt draft is session-only — an attempt exists only once submitted
    D.revAttemptInput.addEventListener("input", () => {
      autoGrow(D.revAttemptInput, 900);
      if (currentId) revDrafts.set(currentId, D.revAttemptInput.value);
    });
    D.revAttemptInput.addEventListener("keydown", (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); submitReverseAttempt(); }
    });
    D.revSubmit.addEventListener("click", submitReverseAttempt);
    D.revPrior.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rev-open]"); if (!b) return;
      revShownAttemptId = b.dataset.revOpen; revMode = "compare"; renderReverseEntry();
      try { D.revCompare.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
    });
    // 문단 카드 · 새 문단
    const onRevPass = (ev) => {
      const del = ev.target.closest("[data-revpassdel]");
      if (del) { ev.stopPropagation(); deleteRevPassage(del.dataset.revpassdel); return; }
      const card = ev.target.closest("[data-revpass]");
      if (card) switchRevPassage(card.dataset.revpass);
    };
    D.revPassBefore.addEventListener("click", onRevPass);
    D.revPassAfter.addEventListener("click", onRevPass);
    D.revAddPassage.addEventListener("click", addRevPassage);

    // marking the revealed target
    D.revHlToolbar.addEventListener("mousedown", (ev) => ev.preventDefault());
    D.revHlToolbar.querySelectorAll(".hl-btn").forEach((b) => b.addEventListener("click", () => applyRevHighlight(b.dataset.type)));
    const maybeRevSelect = () => { if (!D.reverseView.hidden && revTargetEl()) onRevTargetSelect(); };
    document.addEventListener("selectionchange", maybeRevSelect);
    // touch: iOS settles the selection after the finger lifts, and fires
    // selectionchange while dragging the handles — check again on release
    D.revCompare.addEventListener("pointerup", () => setTimeout(maybeRevSelect, 0));
    D.revCompare.addEventListener("touchend", () => setTimeout(maybeRevSelect, 60));
    D.revCompare.addEventListener("mouseover", (ev) => {
      const t = ev.target.closest("#revTargetRead [data-term],#revTargetRead [data-note]");
      if (!t) return;
      clearTimeout(tipTimer); tipTimer = setTimeout(() => showWordTip(t), 130);
    });
    D.revCompare.addEventListener("mouseout", (ev) => { if (ev.target.closest("#revTargetRead [data-term],#revTargetRead [data-note]")) hideWordTip(); });

    D.revCompare.addEventListener("click", (ev) => {
      const tv = ev.target.closest("[data-tview]");
      if (tv) { revTargetView = tv.dataset.tview; hideRevToolbar(); renderReverseEntry(); return; }
      const thDel = ev.target.closest("[data-revthdel]");
      if (thDel) { ev.stopPropagation(); deleteRevThread(thDel.dataset.revthdel); return; }
      if (ev.target.closest("#revRevisions")) { showRevRevisions(); return; }
      if (ev.target.closest("#revInterpSend")) { sendRevInterp(); return; }
      if (ev.target.closest("#revBackToWrite")) { captureRevInterp(); revMode = "write"; renderReverseEntry(); try { D.revAttemptInput.focus(); } catch (_) {} return; }
      if (ev.target.closest("#revFileBtn")) { fileAnalysisPatterns(); return; }
      if (ev.target.closest("#revRetryBtn")) {
        const e = currentEntry(); if (!e || e.kind !== "reverse") return;
        const at = shownAttempt();
        if (at) runReverseAnalysis(e, at);
      }
    });
    // 해석 칸 — same palimpsest rule as 필사: the previous reading is kept
    D.revCompare.addEventListener("input", (ev) => {
      if (ev.target.id !== "revInterpInput") return;
      const e = currentEntry(); if (!e || e.kind !== "reverse") return;
      reverseOf(e).interpretation = ev.target.value;
      autoGrow(ev.target, 420);
      touchEntry(e);
    });
    D.revCompare.addEventListener("focusin", (ev) => {
      if (ev.target.id === "revInterpInput") revInterpSnapshot = ev.target.value;
    });
    D.revCompare.addEventListener("focusout", (ev) => {
      if (ev.target.id === "revInterpInput") captureRevInterp();
    });
    D.revCompare.addEventListener("keydown", (ev) => {
      if (ev.target.id === "revInterpInput" && (ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); sendRevInterp(); }
    });

    // 필사 칸 — the reader hand-copies the correct sentence; saved onto that diff
    D.revCompare.addEventListener("input", (ev) => {
      const ta = ev.target.closest("[data-rev-practice]"); if (!ta) return;
      const e = currentEntry(); if (!e || e.kind !== "reverse") return;
      const at = shownAttempt(); if (!at || !at.analysis) return;
      const d = at.analysis.diffs[+ta.dataset.revPractice]; if (!d) return;
      d.practice = ta.value;
      autoGrow(ta, 260);
      touchEntry(e);
      // flip the ✓ without re-rendering the whole panel (would blow away focus)
      const wrap = ta.closest(".rev-practice");
      const model = wrap.dataset.model || "";
      const done = !!d.practice.trim() && revNormForMatch(d.practice) === revNormForMatch(model);
      wrap.classList.toggle("is-done", done);
      const h = wrap.querySelector(".rev-practice-h");
      const ok = h && h.querySelector(".rev-practice-ok");
      if (done && !ok) h.insertAdjacentHTML("beforeend", `<span class="rev-practice-ok">✓ 일치</span>`);
      else if (!done && ok) ok.remove();
    });

    // patterns view
    D.patternsFilter.addEventListener("input", () => { patternsState.filter = D.patternsFilter.value; renderPatternsView(); });
    D.patternsStarFilter.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-star]"); if (!b) return;
      patternsState.star = b.dataset.star; renderPatternsView();
    });
    D.patternsCats.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-cat]"); if (!b) return;
      patternsState.cat = b.dataset.cat; renderPatternsView();
    });
    D.patternList.addEventListener("click", (ev) => {
      const open = ev.target.closest("[data-open-entry]"); if (open) { go("#daily"); openEntry(open.dataset.openEntry); return; }
      const star = ev.target.closest("[data-pat-star]");
      if (star) {
        const p = state.patterns.find((x) => x.id === star.dataset.patStar);
        if (p) { p.starred = !p.starred; touchAppState(); renderPatternsView(); }
        return;
      }
      const del = ev.target.closest("[data-pat-del]");
      if (del) {
        const p = state.patterns.find((x) => x.id === del.dataset.patDel);
        if (p && confirm("이 패턴을 지울까요?")) { state.patterns = state.patterns.filter((x) => x.id !== p.id); touchAppState(); renderPatternsView(); renderSidebarCounts(); }
      }
    });

    // body: read mode
    // handled on mouseup so a drag-select in read mode enters edit mode AND
    // shows the 단어/구절/묻기 toolbar in one motion (no need to drag twice)
    D.bodyRender.addEventListener("mouseup", (ev) => {
      if (editing) return;
      const anchor = ev.target.closest(".thread-anchor");
      if (anchor) { ev.stopPropagation(); jumpToThread(anchor.dataset.thread); return; }
      // did the user drag-select some text?
      let selRange = null;
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          const r = sel.getRangeAt(0);
          if (D.bodyRender.contains(r.startContainer) && D.bodyRender.contains(r.endContainer)) selRange = r;
        }
      } catch (_) {}
      if (selRange) {
        let s = charOffsetIn(D.bodyRender, selRange.startContainer, selRange.startOffset);
        let e2 = charOffsetIn(D.bodyRender, selRange.endContainer, selRange.endOffset);
        if (s > e2) { const t = s; s = e2; e2 = t; }
        if (e2 > s) {
          enterEdit(s);
          try { D.bodyInput.focus(); D.bodyInput.setSelectionRange(s, e2); } catch (_) {}
          onBodySelChange();
          return;
        }
      }
      // plain click → enter edit at the caret offset
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

    // project detail (art archive + 오답노트 tabs)
    D.projectCuratorEditBtn.addEventListener("click", editCuratorNote);
    D.projectDetailTabs.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-tab]");
      if (!b) return;
      projectDetailTab = b.dataset.tab;
      const { arg } = parseHash();
      if (arg && arg.length) renderProjectDetailView(arg[0]);
    });
    D.projectArtScroll.addEventListener("click", (ev) => {
      const spNew = ev.target.closest("[data-speech-new]");
      if (spNew) {
        const p = getProjects().find((x) => x.key === spNew.dataset.speechNew);
        if (p) openSpeechPractice(p);
        return;
      }
      const spFile = ev.target.closest("[data-speech-file]");
      if (spFile) {
        const e = findEntry(spFile.dataset.speechFile);
        const d = e && e.speech && e.speech.analysis && e.speech.analysis.diffs[+spFile.dataset.diffI];
        if (d) {
          const r = filePattern(d, e.id);
          touchAppState();
          toast(r === "hit" ? "이미 있던 패턴 — 횟수를 올렸습니다" : "나의 패턴에 담았습니다");
          renderSidebarCounts();
          const { arg } = parseHash();
          if (arg && arg.length) renderProjectDetailView(arg[0]);
        }
        return;
      }
      const spRetry = ev.target.closest("[data-speech-retry]");
      if (spRetry) { const e = findEntry(spRetry.dataset.speechRetry); if (e) runSpeechAnalysis(e); return; }
      const spDel = ev.target.closest("[data-speech-del]");
      if (spDel) {
        const e = findEntry(spDel.dataset.speechDel);
        if (e && confirm(`이 발표 기록을 삭제할까요?\n\n${fmtDate(e.date)}\n\n되돌릴 수 없습니다.`)) {
          state.entries = state.entries.filter((x) => x.id !== e.id);
          deletedEntries.add(e.id); dirtyEntries.delete(e.id);
          scheduleSync(); cacheLocal();
          renderSidebarCounts();
          const { arg } = parseHash();
          if (arg && arg.length) renderProjectDetailView(arg[0]);
        }
        return;
      }
      const openBtn = ev.target.closest("[data-open-entry]");
      if (openBtn) { go("#daily"); openEntry(openBtn.dataset.openEntry); return; }
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
      if (!D.tour.hidden) {
        if (ev.key === "Escape") { ev.preventDefault(); closeTour(); }
        else if (ev.key === "ArrowRight" || ev.key === "Enter") { ev.preventDefault(); tourGo(1); }
        else if (ev.key === "ArrowLeft") { ev.preventDefault(); tourGo(-1); }
        return;
      }
      if (ev.key === "Escape") { if (!D.modalScrim.hidden) closeModal(); else if (!D.searchScrim.hidden) closeSearch(); else { closeSlashMenu(); hideToolbar(); } hideWordTip(); }
    });
    window.addEventListener("resize", () => { applySidebar(); if (!D.entryView.hidden) autoGrow(D.interpInput); if (!D.reverseView.hidden) autoGrow(D.revAttemptInput, 900); autoGrow(D.claudeInput, 160); hideToolbar(); hideWordTip(); });
    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("online", () => { online = true; flushSyncNow(); pullAndRefresh(); });
    window.addEventListener("offline", () => { online = false; });
    window.addEventListener("focus", () => { flushSyncNow(); pullAndRefresh(); });
    // periodic safety net: retry any pending uploads, and pick up remote changes
    setInterval(() => {
      if (!user || document.hidden) return;
      if (dirtyEntries.size || dirtyAppState || deletedEntries.size) flushSyncNow();
      else pullAndRefresh();
    }, 20000);
    window.addEventListener("pagehide", () => { captureInterpCorrection(); beaconFlush(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { captureInterpCorrection(); beaconFlush(); }
      else { flushSyncNow(); pullAndRefresh(); }
    });

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
