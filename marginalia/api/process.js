import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const PROMPTS = {
  correct: (context, original) => `You are an English writing corrector.

Context the user is reading/thinking about:
${context}

User's original writing:
${original}

Return JSON only, no markdown fences:
{
  "corrected": "grammatically corrected version",
  "errors": [
    {"tag": "grammar/article", "detail": "missing 'the' before 'concept'"}
  ]
}

Error tag taxonomy (use ONLY these):
grammar/tense, grammar/article, grammar/agreement, grammar/preposition, grammar/other,
expression/awkward, expression/word_choice,
structure/fragment, structure/run_on, structure/clarity

If no errors, return empty array for errors.
Return ONLY valid JSON. No other text.`,

  expand: (context, original) => `You are an English writing tutor and thought partner.

Context: ${context}
Original: ${original}

Return JSON only, no markdown fences:
{
  "corrected": "grammatically corrected version",
  "errors": [{"tag": "...", "detail": "..."}],
  "expressions": ["alternative phrasing 1", "alternative phrasing 2"],
  "summary": "1-2 sentence core idea"
}

Error tag taxonomy (use ONLY these):
grammar/tense, grammar/article, grammar/agreement, grammar/preposition, grammar/other,
expression/awkward, expression/word_choice,
structure/fragment, structure/run_on, structure/clarity

Expressions should preserve meaning but be more natural or precise.
Return ONLY valid JSON. No other text.`,

  deep: (context, original) => `You are an English writing tutor and philosophical interlocutor.

Context: ${context}
Original: ${original}

Return JSON only, no markdown fences:
{
  "corrected": "grammatically corrected version",
  "errors": [{"tag": "...", "detail": "..."}],
  "expressions": ["alternative phrasing 1", "alternative phrasing 2"],
  "summary": "1-2 sentence core idea",
  "questions": ["thought-provoking question that deepens the reflection"]
}

Error tag taxonomy (use ONLY these):
grammar/tense, grammar/article, grammar/agreement, grammar/preposition, grammar/other,
expression/awkward, expression/word_choice,
structure/fragment, structure/run_on, structure/clarity

Questions must push thinking deeper, not confirm what was already said.
Return ONLY valid JSON. No other text.`,
};

function parseBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = parseBody(req);
  const { original, mode, context } = body;

  if (!original || !mode) {
    return res.status(400).json({ error: "Missing original or mode" });
  }

  if (!["correct", "expand", "deep"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });

    const prompt = PROMPTS[mode](context || "", original);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Gemini API error:", err);
    return res.status(500).json({ error: "AI processing failed", detail: err.message });
  }
}
