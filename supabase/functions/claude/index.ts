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

  const turns = Array.isArray(payload?.messages) ? payload.messages : null;
  if (!turns || turns.length === 0) {
    return json({ error: "`messages` (a non-empty array of {role, content}) is required." }, 400);
  }

  const messages = turns
    .map((m: any) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: typeof m?.content === "string" ? m.content : String(m?.content ?? ""),
    }))
    .filter((m: any) => m.content.trim().length > 0);
  if (!messages.length) return json({ error: "No non-empty messages to send." }, 400);

  const reflect = typeof payload?.reflect === "string" ? payload.reflect : "";
  const isReflect = reflect === "correct" || reflect === "expand" || reflect === "deep";
  const extract = !isReflect && payload?.extract === true;

  let system: string;
  if (isReflect) {
    system = buildReflectionSystem(payload?.context, reflect);
  } else {
    system = buildSystem(payload?.context);
    if (extract) system += `\n${EXTRACT_INSTRUCTION}`;
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
