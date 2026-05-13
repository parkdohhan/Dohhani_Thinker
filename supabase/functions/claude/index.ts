// 필사 (Pilsa) — Claude proxy (Supabase Edge Function)
//
// The browser never sees the Anthropic key. The frontend calls this with the
// per-entry conversation turns + a little context about the passage; we forward
// to the Anthropic Messages API and return the assistant's text.
//
// Auth: deployed with verify_jwt = true (the default), so Supabase rejects any
// request without a valid logged-in session token before we even run.
//
// Required secret:  ANTHROPIC_API_KEY
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   (or Dashboard → Project Settings → Edge Functions → Manage secrets)

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("PILSA_CLAUDE_MODEL") ?? "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 1400;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are helping a Korean speaker read English literary and critical texts — Ocean Vuong, Susan Sontag, Maggie Nelson, Theresa Hak Kyung Cha, Don Mee Choi and the like.

Be concise and direct. No filler, no moralizing, no "great question". Treat the reader as a serious adult reader of literature.

When asked about a word or phrase: give its meaning and connotation, the relevant grammar, and what it is *doing* stylistically in this sentence. When the reader offers their own Korean rendering or asks you to check it: name what is accurate, what is off, and any grammar mistakes — then give a cleaner Korean rendering. Quote the smallest necessary fragment of English when you correct something.

Answer in Korean by default (the reader is studying English, so explanation in Korean lands better); keep English words, phrases, and grammatical terms in English. If the reader writes to you in English, you may answer in English.`;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json(
      {
        error:
          "ANTHROPIC_API_KEY is not configured on this Edge Function. Set it with `supabase secrets set ANTHROPIC_API_KEY=...` (or in the Dashboard → Project Settings → Edge Functions → Manage secrets) and try again.",
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
        system: buildSystem(payload?.context),
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
  return json({ text, model: out?.model ?? MODEL, usage: out?.usage ?? null });
});
