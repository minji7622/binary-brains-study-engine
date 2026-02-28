import { NextResponse } from "next/server";
import { z } from "zod";
import { chatComplete } from "@/app/lib/llm";

// --- Input schema -----------------------------------------------------------

const BodySchema = z
  .object({
    subject: z.string().min(1, "Subject is required"),
    difficulty: z.enum(["Easy", "Medium", "Hard", "easy", "medium", "hard"]),
    examDate: z.string(),
    mode: z.enum(["autopilot", "coach", "Autopilot", "Coach"]),
  })
  .transform((data) => ({
    subject: data.subject.trim(),
    difficulty:
      data.difficulty.charAt(0).toUpperCase() + data.difficulty.slice(1).toLowerCase(),
    examDate: data.examDate,
    mode:
      data.mode.charAt(0).toUpperCase() + data.mode.slice(1).toLowerCase() as
        | "Autopilot"
        | "Coach",
  }));

// --- Output schema ----------------------------------------------------------

const AnswerKeySchema = z.enum(["A", "B", "C", "D"]);

const DiagnosticQuestionSchema = z
  .object({
    id: z.string(),
    type: z.enum(["mcq", "short"]),
    question_md: z.string(),
    choices_md: z.array(z.string()).optional(),
    answer_key: z.string().optional(),
    concept_tag: z.string().optional(),
  })
  .refine(
    (q) => {
      if (q.type === "mcq") {
        return (
          Array.isArray(q.choices_md) &&
          q.choices_md.length >= 3 &&
          typeof q.answer_key === "string" &&
          ["A", "B", "C", "D", "a", "b", "c", "d"].includes(q.answer_key)
        );
      }
      return true;
    },
    { message: "MCQ must have 3–4 choices_md and answer_key A/B/C/D" }
  );

const OutputSchema = z.object({
  questions: z
    .array(DiagnosticQuestionSchema)
    .length(7, "Must have exactly 7 questions"),
});

type DiagnosticQuestion = z.infer<typeof DiagnosticQuestionSchema>;

// --- JSON extraction --------------------------------------------------------

/**
 * Find the index of the closing " for a double-quoted string starting at start (index of the opening ").
 * Skips escaped characters. Returns index of closing " or -1.
 */
function skipDoubleQuoted(str: string, start: number): number {
  if (str[start] !== '"') return -1;
  let i = start + 1;
  while (i < str.length) {
    if (str[i] === "\\") { i += 2; continue; }
    if (str[i] === '"') return i;
    i++;
  }
  return -1;
}

/**
 * Given index of "{" or "[", return the index immediately after the matching "}" or "]".
 * String-aware: does not treat { } [ ] inside quoted strings as structure.
 */
function findMatchingEnd(str: string, start: number): number {
  const open = str[start];
  const close = open === "{" ? "}" : "]";
  let i = start + 1;
  while (i < str.length) {
    const c = str[i];
    if (c === '"') {
      const end = skipDoubleQuoted(str, i);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === "{" || c === "[") {
      const end = findMatchingEnd(str, i);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (c === close) return i + 1;
    i++;
  }
  return -1;
}

/**
 * Extract the JSON object that contains the "questions" key. Strips code fences,
 * finds '"questions"', scans backward to the opening '{', then uses string-aware
 * brace matching. Returns the JSON substring or null if not found.
 */
function extractQuestionsObject(text: string): string | null {
  let raw = text.trim();
  // 1) Strip code fences if present
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) raw = fenced[1].trim();
  // 2) Find index of '"questions"' (including quotes)
  const questionsKeyIndex = raw.indexOf('"questions"');
  if (questionsKeyIndex === -1) return null;
  // 3) Scan backward to the nearest '{' BEFORE it
  const braceIndex = raw.lastIndexOf("{", questionsKeyIndex - 1);
  if (braceIndex === -1) return null;
  // 4) Use findMatchingEnd to get the full JSON object
  const end = findMatchingEnd(raw, braceIndex);
  if (end === -1) return null;
  // 5) Return the JSON substring
  return raw.slice(braceIndex, end);
}

/** Fallback questions when "questions" key is not found in model output. */
function getFallbackQuestions(subject: string): { questions: DiagnosticQuestion[] } {
  const sub = subject.trim() || "this subject";
  const questions: DiagnosticQuestion[] = [
    ...([1, 2, 3, 4] as const).map((i) => ({
      id: `q${i}`,
      type: "mcq" as const,
      question_md: `Which best describes a core ${sub} concept?`,
      choices_md: ["Option A", "Option B", "Option C", "Option D"],
      answer_key: "A" as const,
      concept_tag: "core_concept",
    })),
    ...([1, 2, 3] as const).map((i) => ({
      id: `q${4 + i}`,
      type: "short" as const,
      question_md: `Briefly state a main idea in ${sub}.`,
      concept_tag: "key_idea",
    })),
  ];
  return { questions };
}

/** Remove BOM, trailing commas, and fix common LLM output so JSON.parse can succeed. */
function sanitizeJsonString(s: string): string {
  let out = s.trim().replace(/\uFEFF/g, "");
  // Trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, "$1");
  // Fix unquoted key at start of root object only: { questions: -> { "questions":
  out = out.replace(/^\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/, (_, key) => `{ "${key}":`);
  return out;
}

// --- Prompt ------------------------------------------------------------------

function buildPrompt(subject: string, difficulty: string): string {
  return `Generate a diagnostic quiz for a student studying for an exam.

Subject: ${subject}
Difficulty: ${difficulty}

Output EXACTLY 7 questions in this format (raw JSON only, no markdown fences, no \`\`\`):
- 4 multiple-choice (type "mcq"): each must have question_md, choices_md (array of exactly 4 strings), answer_key ("A","B","C", or "D"), and concept_tag.
- 3 short-answer (type "short"): question_md and concept_tag only.

Rules:
- Questions must be genuinely about ${subject} and suitable for exam prep at ${difficulty} level.
- Write meaningful, distinct choices for MCQs (not "Option A/B/C/D"). answer_key must match one of the four choices by position (A=first, B=second, C=third, D=fourth).
- Use inline LaTeX for math where needed, e.g. $x^2$ or $\\frac{1}{2}$. No block math, no code fences.
- Use ids: "q1" through "q7". concept_tag should be a short topic label (e.g. "quadratic_equations").
- Output a single JSON object with one key: "questions", an array of 7 question objects. No other commentary.`;
}

// --- Handler -----------------------------------------------------------------

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    body = BodySchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const detail = err.issues.map((i) => i.message).join("; ");
      return NextResponse.json(
        { error: "Invalid request", detail },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const prompt = buildPrompt(body.subject, body.difficulty);

  const systemContent =
    "You output only valid JSON. No markdown code blocks, no explanation, no text before or after the JSON object.";

  const startMs = Date.now();
  let rawText: string;

  try {
    rawText = await chatComplete({
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      maxTokens: 650,
      temperature: 0.3,
      timeoutMs: 45000,
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error("[generate-diagnostic] LLM call failed after %d ms:", durationMs, err);
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      /aborted|AbortError/i.test(message) ||
      (err instanceof Error && err.name === "AbortError");
    if (isTimeout) {
      const fallback = getFallbackQuestions(body.subject);
      return NextResponse.json(
        { ...fallback, meta: { reason: "timeout" } },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: "Model request failed", detail: message },
      { status: 502 }
    );
  }

  const durationMs = Date.now() - startMs;
  console.log("[generate-diagnostic] LLM call completed in %d ms", durationMs);

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  if (debug) {
    console.log("[generate-diagnostic] rawText preview:", rawText.slice(0, 300));
    return NextResponse.json({ rawText, durationMs }, { status: 200 });
  }

  const content = typeof rawText === "string" ? rawText : "";
  const jsonStr = extractQuestionsObject(content);
  if (jsonStr === null) {
    console.error("[generate-diagnostic] No 'questions' key found. Snippet:", content.slice(0, 500).replace(/\n/g, " "));
    const fallback = getFallbackQuestions(body.subject);
    return NextResponse.json(
      { ...fallback, meta: { reason: "no_questions_key" } },
      { status: 200 }
    );
  }

  const toParse = sanitizeJsonString(jsonStr);
  let parsed: unknown;
  try {
    parsed = JSON.parse(toParse);
  } catch (err) {
    const snippet = toParse.slice(0, 400);
    console.error("[generate-diagnostic] JSON parse error:", err);
    console.error("[generate-diagnostic] Extracted length:", toParse.length, "Preview:", JSON.stringify(snippet));
    const fallback = getFallbackQuestions(body.subject);
    return NextResponse.json(
      { ...fallback, meta: { reason: "parse_error" } },
      { status: 200 }
    );
  }

  let raw = parsed as { questions?: Array<Record<string, unknown>> };

  if (!raw?.questions || !Array.isArray(raw.questions)) {
    console.error("[generate-diagnostic] Missing or invalid 'questions' array");
    return NextResponse.json(
      { error: "Invalid model response", detail: "Missing 'questions' array." },
      { status: 500 }
    );
  }

  // Normalize and coerce each question for lenient validation
  raw.questions = raw.questions.map((q: Record<string, unknown>) => {
    const question_md = (q.question_md ?? q.question ?? "") as string;
    let choices_md = (q.choices_md ?? q.choices) as string[] | undefined;
    if (q.type === "mcq" && Array.isArray(choices_md) && choices_md.length >= 3 && choices_md.length < 4) {
      choices_md = [...choices_md, "None of the above"];
    }
    if (Array.isArray(choices_md) && choices_md.length > 4) choices_md = choices_md.slice(0, 4);
    let answer_key = (q.answer_key ?? "") as string;
    if (answer_key && answer_key.length === 1) answer_key = answer_key.toUpperCase();
    if (["1", "2", "3", "4"].includes(answer_key)) answer_key = String.fromCharCode(64 + parseInt(answer_key, 10));
    const concept_tag = ((q.concept_tag ?? "topic") as string) || "topic";
    return {
      ...q,
      question_md,
      choices_md: choices_md ?? [],
      answer_key,
      concept_tag,
    };
  });

  const result = OutputSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => i.message).join("; ");
    console.error("[generate-diagnostic] Validation failed:", detail);
    return NextResponse.json(
      {
        error: "Invalid diagnostic format",
        detail,
      },
      { status: 500 }
    );
  }

  // Ensure exactly 4 MCQ then 3 short (or validate distribution)
  const questions = result.data.questions;
  const mcqCount = questions.filter((q) => q.type === "mcq").length;
  const shortCount = questions.filter((q) => q.type === "short").length;
  if (mcqCount !== 4 || shortCount !== 3) {
    const detail = `Expected 4 MCQ and 3 short-answer; got ${mcqCount} MCQ and ${shortCount} short.`;
    console.error("[generate-diagnostic]", detail);
    return NextResponse.json(
      { error: "Invalid diagnostic format", detail },
      { status: 500 }
    );
  }

  const normalized: DiagnosticQuestion[] = questions.map((q) => ({
    id: q.id,
    type: q.type,
    question_md: q.question_md,
    concept_tag: q.concept_tag ?? "topic",
    ...(q.type === "mcq" && {
      choices_md: ((q.choices_md ?? []).length >= 4 ? (q.choices_md ?? []).slice(0, 4) : [...(q.choices_md ?? []), "None of the above"].slice(0, 4)),
      answer_key: (() => {
        const key = (q.answer_key ?? "A").toString().toUpperCase().slice(0, 1);
        return ["A", "B", "C", "D"].includes(key) ? key : "A";
      })(),
    }),
  }));

  return NextResponse.json({ questions: normalized });
}
