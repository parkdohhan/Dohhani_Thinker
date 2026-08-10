// 필사 (Pilsa) — Claude proxy (Supabase Edge Function)
//
// The browser never sees the Anthropic key. The frontend calls this with the
// per-entry conversation turns + a little context about the passage; we forward
// to the Anthropic Messages API and return the assistant's text.
//
// Auth: deployed with verify_jwt = true (the default), so Supabase rejects any
// request without a valid logged-in session token before we even run.
//
// Required secret:  dohhanithinker  (preferred name for this project)
//   — falls back to DOHHANITHINKER / DOHHANITHINKER_API_KEY / ANTHROPIC_API_KEY
//   supabase secrets set dohhanithinker=sk-ant-...
//   (or Dashboard → Project Settings → Edge Functions → Manage secrets)

const ANTHROPIC_API_KEY =
  Deno.env.get("dohhanithinker") ??
  Deno.env.get("DOHHANITHINKER") ??
  Deno.env.get("DOHHANITHINKER_API_KEY") ??
  Deno.env.get("ANTHROPIC_API_KEY") ??
  "";
const MODEL = Deno.env.get("PILSA_CLAUDE_MODEL") ?? "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 1800;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are helping a Korean speaker read English literary and critical texts — Ocean Vuong, Susan Sontag, Maggie Nelson, Theresa Hak Kyung Cha, Don Mee Choi and the like.

Be concise and direct. No filler, no moralizing, no "great question". Treat the reader as a serious adult reader of literature.

When asked about a word or phrase: give its meaning and connotation, the relevant grammar, and what it is *doing* stylistically in this sentence. When the reader offers their own Korean rendering or asks you to check it: name what is accurate, what is off, and any grammar mistakes — then give a cleaner Korean rendering. Quote the smallest necessary fragment of English when you correct something.

Answer in Korean by default (the reader is studying English, so explanation in Korean lands better); keep English words, phrases, and grammatical terms in English. If the reader writes to you in English, you may answer in English.`;

// === 사유 (reflection) mode ===
// The reader writes their own prose (in English, Korean, or mixed) and asks for
// a corrected version + a list of mistakes, explained in Korean. JSON only.
const REFLECT_CORRECT_PROMPT = `You are a bilingual writing tutor for a Korean speaker who is practicing serious prose — literary reflection, journaling, criticism. The reader writes in English, Korean, or a mix. Your job: correct the mistakes and explain — in Korean — what was wrong and why.

Be precise and concise. Fix what is wrong; do not rewrite for style. Preserve the writer's voice and word choices. Stay in the language they wrote in (if the input is English, the corrected version is English; if Korean, Korean; if mixed, mixed). Quote only the smallest fragment needed when explaining a specific mistake.

Return STRICT JSON only — no markdown fences, no prose before or after. Schema:

{
  "corrected": "<the reader's text with mistakes fixed, same language as input>",
  "errors": [
    {"tag": "grammar/article", "detail": "<한국어로 무엇이 틀렸고 왜 틀렸는지>"}
  ]
}

Use ONLY these error tags:
grammar/tense, grammar/article, grammar/agreement, grammar/preposition, grammar/other,
expression/awkward, expression/word_choice,
structure/fragment, structure/run_on, structure/clarity

If there are no errors, return errors: []. Return ONLY the JSON object — no text before or after, no code fences.`;

function buildReflectionSystem(ctx: any, mode: string): string {
  let base = REFLECT_CORRECT_PROMPT; // only "correct" for now; expand/deep land later
  if (!ctx || typeof ctx !== "object") return base;
  const src = [ctx.author, ctx.title].filter(Boolean).join(" · ");
  if (src) base += `\n\n--- Context: the reader is reflecting on / responding to ---\n${src}`;
  return base;
}

function parseReflectJSON(text: string): any | null {
  if (!text) return null;
  let s = text.trim();
  // strip optional code fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // try direct parse
  try { return JSON.parse(s); } catch { /* fall through */ }
  // try to locate the first {...} block
  const m = /\{[\s\S]*\}/.exec(s);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return null;
}

function normalizeReflectResult(parsed: any, mode: string, fallbackText: string) {
  const out: any = { mode, corrected: "", errors: [], expressions: [], summary: "", questions: [] };
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.corrected === "string") out.corrected = parsed.corrected;
    if (Array.isArray(parsed.errors)) {
      out.errors = parsed.errors
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => ({
          tag: typeof x.tag === "string" ? x.tag : "grammar/other",
          detail: typeof x.detail === "string" ? x.detail : "",
        }))
        .slice(0, 20);
    }
    if (Array.isArray(parsed.expressions)) {
      out.expressions = parsed.expressions.filter((x: any) => typeof x === "string").slice(0, 6);
    }
    if (typeof parsed.summary === "string") out.summary = parsed.summary;
    if (Array.isArray(parsed.questions)) {
      out.questions = parsed.questions.filter((x: any) => typeof x === "string").slice(0, 4);
    }
  }
  // If parsing failed entirely, surface the raw text so the UI can still show *something*
  if (!parsed && fallbackText) out.corrected = fallbackText;
  return out;
}

// === 역번역 (reverse translation) mode ===
// The reader has a Korean paragraph of their own academic prose and an English
// translation of it (the "target"). They reproduce the English from memory and
// we compare their attempt against the target. JSON only.
const REVERSE_PROMPT = `You are analyzing a Korean→English reverse-translation drill. The reader is a Korean academic writer training to produce English prose. They were shown only the Korean source and wrote an English version from it; the "target" is a separate English translation of the same Korean.

Compare the reader's attempt against the target and account for every meaningful difference. Be precise and concise. Write the notes in Korean, in plain analytic register (분석체 — no 존댓말, no praise, no filler); keep English words, phrases and grammatical terms in English.

Classify each difference into exactly one category:
- "lexis-register": word choice, collocation, formality/academic register
- "connectives": however / thus / whereas / that is — discourse markers and how clauses are joined
- "structure": clause order, nominalization vs. verb, voice, sentence splitting/merging, information order
- "articles-prepositions": a/an/the, singular/plural, and preposition choice

The target is itself a machine translation — it is NOT an infallible answer key. Where the reader's wording is as good as or better than the target, put it in "better" instead of "diffs" and say why in Korean.

Ignore trivial differences: capitalization, punctuation style, obvious typos, and pure whitespace.

Return STRICT JSON only — no markdown fences, no prose before or after. Schema:

{
  "verdict": "<한 줄 총평 — 이번 시도에서 가장 두드러진 경향 하나>",
  "diffs": [
    {"mine": "<내 표현 — attempt에서 그대로 인용>",
     "targetFrag": "<대응하는 target 표현 — target에서 그대로 인용>",
     "category": "lexis-register",
     "note": "<왜 갈렸는지 한 문장>"}
  ],
  "better": ["<내 출력이 target보다 낫거나 동등한 지점 — 한 문장씩>"]
}

At most 12 diffs; put the ones that matter most first. If nothing differs meaningfully, return diffs: []. Return ONLY the JSON object.`;

function buildReverseSystem(ctx: any): string {
  let base = REVERSE_PROMPT;
  if (!ctx || typeof ctx !== "object") return base;
  const src = [ctx.author, ctx.title, ctx.page].filter(Boolean).join(" · ");
  if (src) base += `\n\n--- Context: the paper / section this paragraph comes from ---\n${src}`;
  return base;
}

function buildReverseUserMessage(
  koSource: string,
  target: string,
  attempt: string,
  priorAttempts: string[],
): string {
  const parts = [
    `[Korean source]\n${koSource.trim()}`,
    `[Target English translation]\n${target.trim()}`,
    `[The reader's attempt]\n${attempt.trim()}`,
  ];
  if (priorAttempts.length) {
    parts.push(
      `[The reader's earlier attempts at this same paragraph, oldest first]\n` +
        priorAttempts.map((t, i) => `(${i + 1}) ${t.trim()}`).join("\n\n") +
        `\n\nIf a mistake from an earlier attempt is now fixed, or has come back, say so in "verdict".`,
    );
  }
  return parts.join("\n\n");
}

function normalizeReverseResult(parsed: any, fallbackText: string) {
  const CATEGORIES = ["lexis-register", "connectives", "structure", "articles-prepositions"];
  const out: any = { verdict: "", diffs: [], better: [] };
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.verdict === "string") out.verdict = parsed.verdict;
    if (Array.isArray(parsed.diffs)) {
      out.diffs = parsed.diffs
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => ({
          mine: typeof x.mine === "string" ? x.mine.slice(0, 400) : "",
          targetFrag: typeof x.targetFrag === "string" ? x.targetFrag.slice(0, 400) : "",
          category: CATEGORIES.includes(x.category) ? x.category : "structure",
          note: typeof x.note === "string" ? x.note.slice(0, 800) : "",
        }))
        .filter((x: any) => x.mine || x.targetFrag)
        .slice(0, 12);
    }
    if (Array.isArray(parsed.better)) {
      out.better = parsed.better.filter((x: any) => typeof x === "string").map((x: string) => x.slice(0, 500)).slice(0, 6);
    }
  }
  // If parsing failed entirely, surface the raw text so the UI can still show *something*
  if (!parsed && fallbackText) out.verdict = fallbackText.slice(0, 1200);
  return out;
}

// === 발표 (speech practice) mode ===
// The reader spoke freely (no script) about a project's material; the browser
// transcribed it and they hand-corrected the transcript. We judge coverage
// against the source paragraphs and the quality of the spoken English. JSON only.
const SPEECH_PROMPT = `You are reviewing a spoken presentation drill. The reader is a Korean academic training to present their work in English. They spoke freely — no script, only a few keywords — about the source material below. The transcript comes from browser speech recognition and was hand-corrected, so ignore punctuation, capitalization, and minor transcription artifacts entirely.

Judge two things:

1. Coverage — against the source paragraphs: which key points were missed, garbled, or misordered. Each item goes in "missed", written in Korean, one sentence each. If coverage is complete, missed: [].

2. Spoken expression — where the wording is unclear, imprecise, or below academic register: quote the reader's wording verbatim from the transcript ("mine") and give what a fluent speaker would actually SAY ("targetFrag") — natural spoken register, not written prose. Classify each into exactly one category:
- "lexis-register": word choice, collocation, formality
- "connectives": discourse markers, how ideas are joined in speech
- "structure": clause order, sentence shape, information order
- "articles-prepositions": a/an/the, singular/plural, preposition choice

Do not nitpick disfluencies (fillers, repetition, false starts) unless they bury the point. Notes in Korean, plain analytic register (분석체 — no 존댓말, no praise); keep English words and terms in English.

If recurring patterns from the reader's written drills are provided, watch for them specifically: one recurring in speech gets said in its note; one clearly improved gets mentioned in "verdict".

Return STRICT JSON only — no markdown fences, no prose before or after. Schema:

{
  "verdict": "<한 줄 총평 — 이번 발표에서 가장 두드러진 경향 하나>",
  "missed": ["<요점에서 빠지거나 어긋난 것 — 한국어 한 문장>"],
  "diffs": [
    {"mine": "<말한 표현 — transcript에서 그대로 인용>",
     "targetFrag": "<말로 했을 법한 더 나은 표현>",
     "category": "lexis-register",
     "note": "<왜 그게 나은지 한 문장>"}
  ]
}

At most 10 diffs, most important first. Return ONLY the JSON object.`;

function buildSpeechSystem(ctx: any): string {
  let base = SPEECH_PROMPT;
  if (!ctx || typeof ctx !== "object") return base;
  const src = [ctx.author, ctx.title].filter(Boolean).join(" · ");
  if (src) base += `\n\n--- Context: the project this talk is about ---\n${src}`;
  return base;
}

function buildSpeechUserMessage(
  transcript: string,
  keywords: string[],
  sources: string[],
  patterns: Array<{ mine: string; targetFrag: string; category: string }>,
): string {
  const parts: string[] = [];
  if (sources.length) {
    parts.push(`[Source paragraphs the talk should cover]\n` + sources.map((s, i) => `(${i + 1}) ${s}`).join("\n\n"));
  }
  if (keywords.length) parts.push(`[Keywords the reader planned to hit]\n${keywords.join(", ")}`);
  if (patterns.length) {
    parts.push(`[Recurring divergences from the reader's written drills — watch for these]\n` +
      patterns.map((p) => `- "${p.mine}" → "${p.targetFrag}" (${p.category})`).join("\n"));
  }
  parts.push(`[Transcript of the talk]\n${transcript.trim()}`);
  return parts.join("\n\n");
}

function normalizeSpeechResult(parsed: any, fallbackText: string) {
  const CATEGORIES = ["lexis-register", "connectives", "structure", "articles-prepositions"];
  const out: any = { verdict: "", missed: [], diffs: [] };
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.verdict === "string") out.verdict = parsed.verdict;
    if (Array.isArray(parsed.missed)) {
      out.missed = parsed.missed.filter((x: any) => typeof x === "string").map((x: string) => x.slice(0, 500)).slice(0, 10);
    }
    if (Array.isArray(parsed.diffs)) {
      out.diffs = parsed.diffs
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => ({
          mine: typeof x.mine === "string" ? x.mine.slice(0, 400) : "",
          targetFrag: typeof x.targetFrag === "string" ? x.targetFrag.slice(0, 400) : "",
          category: CATEGORIES.includes(x.category) ? x.category : "lexis-register",
          note: typeof x.note === "string" ? x.note.slice(0, 800) : "",
        }))
        .filter((x: any) => x.mine || x.targetFrag)
        .slice(0, 10);
    }
  }
  if (!parsed && fallbackText) out.verdict = fallbackText.slice(0, 1200);
  return out;
}

// Appended to the system prompt when the frontend asks for structured "picks" —
// the words/phrases the reader was unsure about, so they can be filed in 나의 단어 / 나의 문장.
const EXTRACT_INSTRUCTION = `
--- After your answer ---
The reader's message is their own notes on the passage shown in the context above — a Korean rendering and/or the things they're unsure about. Answer it normally first (in Korean).

THEN append exactly one block in this format, and write NOTHING after it:

<picks>
[{"kind":"word","text":"<the English word as it appears in the passage, lowercase>","note":"<short Korean gloss + how it's used here>"},
 {"kind":"phrase","text":"<an English phrase / clause / sentence copied verbatim from the passage>","note":"<1-2 sentences: the grammar or sense the reader missed, and/or a cleaner Korean rendering>"}]
</picks>

Rules for <picks>:
- Include only the items your answer actually addressed — the words/phrases the reader was confused about. One item is fine. Never more than 6.
- "word" = a single vocabulary item. "phrase" = anything multi-word, up to a whole sentence.
- For "phrase", "text" MUST be copied verbatim from the passage above (exact characters) so it can be located in the text. Do not paraphrase it.
- Strict JSON: double quotes only, no trailing commas, no comments, no code fences. If there is genuinely nothing worth filing, output: <picks>[]</picks>`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function buildSystem(ctx: any): string {
  if (!ctx || typeof ctx !== "object") return SYSTEM_PROMPT;
  const lines: string[] = [];
  const src = [ctx.author, ctx.title, ctx.page].filter(Boolean).join(" · ");
  if (src) lines.push(`Source: ${src}`);
  if (typeof ctx.body === "string" && ctx.body.trim()) {
    lines.push(`Passage the reader transcribed:\n${ctx.body.trim()}`);
  }
  if (typeof ctx.interpretation === "string" && ctx.interpretation.trim()) {
    lines.push(`The reader's own Korean rendering so far:\n${ctx.interpretation.trim()}`);
  }
  if (typeof ctx.selection === "string" && ctx.selection.trim()) {
    lines.push(`The reader is asking about this part specifically:\n"${ctx.selection.trim()}"`);
  }
  if (!lines.length) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\n--- Context for this conversation ---\n${lines.join("\n\n")}`;
}

interface Pick { kind: "word" | "phrase"; text: string; note: string }
function splitPicks(text: string): { reply: string; picks: Pick[] } {
  const m = /<picks>\s*([\s\S]*?)\s*<\/picks>/i.exec(text);
  if (!m) return { reply: text.trim(), picks: [] };
  const raw = m[1].trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let arr: unknown = [];
  try { arr = JSON.parse(raw); } catch { arr = []; }
  const picks: Pick[] = (Array.isArray(arr) ? arr : [])
    .filter((p: any) => p && typeof p === "object" && typeof p.text === "string" && p.text.trim())
    .map((p: any): Pick => ({
      kind: p.kind === "word" ? "word" : "phrase",
      text: String(p.text).trim().slice(0, 400),
      note: typeof p.note === "string" ? p.note.trim().slice(0, 1200) : "",
    }))
    .slice(0, 10);
  const reply = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  return { reply: reply || (picks.length ? "(아래 단어·문장을 나의 노트에 정리했습니다.)" : text.trim()), picks };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json(
      {
        error:
          "Anthropic API key is not configured on this Edge Function. Set the `dohhanithinker` secret (Dashboard → Project Settings → Edge Functions → Manage secrets, or `supabase secrets set dohhanithinker=sk-ant-...`) and try again.",
      },
      503,
    );
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }

  const isReverse = payload?.reverse === true;
  const isSpeech = !isReverse && payload?.speech === true;
  const reflect = typeof payload?.reflect === "string" ? payload.reflect : "";
  const isReflect = !isReverse && !isSpeech && (reflect === "correct" || reflect === "expand" || reflect === "deep");
  const extract = !isReverse && !isSpeech && !isReflect && payload?.extract === true;

  let messages: Array<{ role: string; content: string }>;
  let system: string;

  if (isSpeech) {
    // 발표: the frontend sends the transcript + the project's material, not a conversation.
    const transcript = typeof payload?.transcript === "string" ? payload.transcript : "";
    if (!transcript.trim()) return json({ error: "`transcript` (the spoken text) is required." }, 400);
    const keywords = (Array.isArray(payload?.keywords) ? payload.keywords : [])
      .filter((x: any) => typeof x === "string" && x.trim()).slice(0, 12);
    const sources = (Array.isArray(payload?.sources) ? payload.sources : [])
      .filter((x: any) => typeof x === "string" && x.trim()).slice(0, 40);
    const patterns = (Array.isArray(payload?.patterns) ? payload.patterns : [])
      .filter((x: any) => x && typeof x === "object" && typeof x.mine === "string")
      .map((x: any) => ({
        mine: String(x.mine).slice(0, 200),
        targetFrag: typeof x.targetFrag === "string" ? x.targetFrag.slice(0, 200) : "",
        category: typeof x.category === "string" ? x.category : "",
      }))
      .slice(0, 8);
    system = buildSpeechSystem(payload?.context);
    messages = [{ role: "user", content: buildSpeechUserMessage(transcript, keywords, sources, patterns) }];
  } else if (isReverse) {
    // 역번역: the frontend sends the drill itself, not a conversation.
    const koSource = typeof payload?.koSource === "string" ? payload.koSource : "";
    const target = typeof payload?.target === "string" ? payload.target : "";
    const attempt = typeof payload?.attempt === "string" ? payload.attempt : "";
    if (!attempt.trim()) return json({ error: "`attempt` (the reader's English) is required." }, 400);
    if (!target.trim()) return json({ error: "`target` (the reference English) is required." }, 400);
    const priorAttempts = (Array.isArray(payload?.priorAttempts) ? payload.priorAttempts : [])
      .filter((x: any) => typeof x === "string" && x.trim())
      .slice(-3);
    system = buildReverseSystem(payload?.context);
    messages = [{ role: "user", content: buildReverseUserMessage(koSource, target, attempt, priorAttempts) }];
  } else {
    const turns = Array.isArray(payload?.messages) ? payload.messages : null;
    if (!turns || turns.length === 0) {
      return json({ error: "`messages` (a non-empty array of {role, content}) is required." }, 400);
    }
    messages = turns
      .map((m: any) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: typeof m?.content === "string" ? m.content : String(m?.content ?? ""),
      }))
      .filter((m: any) => m.content.trim().length > 0);
    if (!messages.length) return json({ error: "No non-empty messages to send." }, 400);

    if (isReflect) {
      system = buildReflectionSystem(payload?.context, reflect);
    } else {
      system = buildSystem(payload?.context);
      if (extract) system += `\n${EXTRACT_INSTRUCTION}`;
    }
  }

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
      }),
    });
  } catch (e) {
    return json({ error: `Could not reach the Anthropic API: ${String(e)}` }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return json({ error: `Anthropic API error (${resp.status}).`, detail }, 502);
  }

  const out = await resp.json().catch(() => null);
  const text = (out?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  if (!text) return json({ error: "Empty response from Claude.", raw: out }, 502);

  if (isSpeech) {
    const parsed = parseReflectJSON(text); // same fence-stripping / first-{…} recovery
    const result = normalizeSpeechResult(parsed, parsed ? "" : text);
    return json({ speech: result, model: out?.model ?? MODEL, usage: out?.usage ?? null });
  }
  if (isReverse) {
    const parsed = parseReflectJSON(text); // same fence-stripping / first-{…} recovery
    const result = normalizeReverseResult(parsed, parsed ? "" : text);
    return json({ reverse: result, model: out?.model ?? MODEL, usage: out?.usage ?? null });
  }
  if (isReflect) {
    const parsed = parseReflectJSON(text);
    const result = normalizeReflectResult(parsed, reflect, parsed ? "" : text);
    return json({ reflect: result, model: out?.model ?? MODEL, usage: out?.usage ?? null });
  }
  if (extract) {
    const { reply, picks } = splitPicks(text);
    return json({ text: reply, picks, model: out?.model ?? MODEL, usage: out?.usage ?? null });
  }
  return json({ text, model: out?.model ?? MODEL, usage: out?.usage ?? null });
});
