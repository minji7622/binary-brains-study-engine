import { NextResponse } from "next/server";
import { z } from "zod";
import { chatComplete } from "@/app/lib/llm";

const QuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["mcq", "short"]),
  question_md: z.string(),
  choices_md: z.array(z.string()).optional(),
  answer_key: z.string().nullable().optional(),
  concept_tag: z.string().nullable().optional(),
});

const UserAnswerSchema = z.object({
  answer: z.string(),
  noIdea: z.boolean(),
});

const BodySchema = z.object({
  questions: z.array(QuestionSchema).length(7),
  answers: z.array(UserAnswerSchema).length(7),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
});

const WeaknessSchema = z.object({
  concept_tag: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  evidence: z.string(),
  fix_suggestion: z.string(),
  description: z.string().optional(),
});

const OutputSchema = z.object({
  mastery_percent: z.number().min(0).max(100),
  weaknesses: z.array(WeaknessSchema).max(5),
  micro_patterns: z
    .object({
      careless_mistake_patterns: z.array(z.string()).max(3).optional(),
      conceptual_blind_spots: z.array(z.string()).optional(),
    })
    .optional(),
  strong_learner: z.boolean().optional(),
  predicted_score: z
    .object({
      today: z.number().min(0).max(99),
      after_7_days: z.number().min(0).max(99),
      after_fixing_top3: z.number().min(0).max(99),
    })
    .optional(),
  recommended_mode: z.enum(["Autopilot", "Coach"]),
  mode_reasoning: z.string(),
  time_to_mastery_minutes: z
    .number()
    .transform((n) => Math.round(Math.max(15, Math.min(300, n)))),
});

const ANALYZE_TIMEOUT_MS = 15_000;
const MAX_TOKENS = 450;

const DIFFICULTY_WEIGHT: Record<string, number> = {
  Easy: 1,
  Medium: 1.2,
  Hard: 1.5,
};

type DeterministicMetrics = {
  total_weight: number;
  total_score: number;
  base_mastery_percent: number;
  confidence_penalty: number;
  total_noIdea: number;
  total_correct_mcq: number;
  total_mcq: number;
  short_answer_attempts: number;
};

function computeDeterministicMastery(
  questions: z.infer<typeof QuestionSchema>[],
  answers: z.infer<typeof UserAnswerSchema>[],
  difficulty: "Easy" | "Medium" | "Hard"
): DeterministicMetrics {
  const weight = DIFFICULTY_WEIGHT[difficulty] ?? 1.2;
  let total_score = 0;
  let confidence_penalty = 0;
  let total_noIdea = 0;
  let total_correct_mcq = 0;
  let total_mcq = 0;
  let short_answer_attempts = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i];
    if (!a) continue;

    if (a.noIdea === true) {
      total_score += 0;
      confidence_penalty += 1;
      total_noIdea += 1;
      if (q.type === "mcq") total_mcq += 1;
      continue;
    }

    if (q.type === "mcq") {
      total_mcq += 1;
      const correct = (q.answer_key ?? "").toString().trim().toUpperCase();
      const given = (a.answer ?? "").toString().trim().toUpperCase();
      if (given !== "" && correct !== "" && given === correct) {
        total_score += weight;
        total_correct_mcq += 1;
      }
      continue;
    }

    if (q.type === "short") {
      const given = (a.answer ?? "").toString().trim();
      if (given !== "") {
        total_score += weight * 0.7;
        short_answer_attempts += 1;
      }
    }
  }

  const total_weight = questions.length * weight;
  const base_mastery_percent =
    total_weight > 0 ? (total_score / total_weight) * 100 : 0;

  return {
    total_weight,
    total_score,
    base_mastery_percent,
    confidence_penalty,
    total_noIdea,
    total_correct_mcq,
    total_mcq,
    short_answer_attempts,
  };
}

/** Per concept_tag: count of incorrect and list of question IDs (for fallback weaknesses). */
function getIncorrectByConcept(
  questions: z.infer<typeof QuestionSchema>[],
  answers: z.infer<typeof UserAnswerSchema>[]
): { concept_tag: string; count: number; qIds: string[] }[] {
  const countMap = new Map<string, number>();
  const idsMap = new Map<string, string[]>();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i];
    if (!a) continue;
    const tag = (q.concept_tag ?? "topic").toString().trim() || "topic";
    const wrong =
      a.noIdea ||
      (q.type === "mcq" &&
        (q.answer_key ?? "").toString().trim().toUpperCase() !==
          (a.answer ?? "").toString().trim().toUpperCase());
    if (wrong) {
      countMap.set(tag, (countMap.get(tag) ?? 0) + 1);
      const arr = idsMap.get(tag) ?? [];
      arr.push(q.id ?? `q${i + 1}`);
      idsMap.set(tag, arr);
    }
  }
  return Array.from(countMap.entries())
    .map(([concept_tag, count]) => ({
      concept_tag,
      count,
      qIds: idsMap.get(concept_tag) ?? [],
    }))
    .sort((a, b) => b.count - a.count);
}

/** Deterministic fallback analysis when AI times out or parse/validation fails. */
function getFallbackAnalysis(
  questions: z.infer<typeof QuestionSchema>[],
  answers: z.infer<typeof UserAnswerSchema>[],
  difficulty: "Easy" | "Medium" | "Hard"
): z.infer<typeof OutputSchema> & { careless_patterns?: string[] } {
  const det = computeDeterministicMastery(questions, answers, difficulty);
  const mastery = Math.round(Math.min(100, Math.max(0, det.base_mastery_percent)));
  const incorrect = getIncorrectByConcept(questions, answers);
  const top3 = incorrect.slice(0, 3).map((x, i) => ({
    concept_tag: x.concept_tag,
    severity: (i === 0 ? "high" : i === 1 ? "medium" : "low") as "high" | "medium" | "low",
    evidence: x.qIds.length > 0 ? x.qIds.join(", ") : "—",
    fix_suggestion: `Review ${x.concept_tag} and practice related questions.`,
  }));
  const recommended_mode = mastery < 60 ? "Autopilot" : "Coach";
  const today = Math.min(99, mastery);
  const after7 = Math.min(99, mastery + 8);
  const afterTop3 = Math.min(99, mastery + 15);
  return {
    mastery_percent: mastery,
    weaknesses: top3,
    micro_patterns: {},
    strong_learner: mastery >= 85,
    predicted_score: { today, after_7_days: after7, after_fixing_top3: afterTop3 },
    recommended_mode,
    mode_reasoning: `Based on your diagnostic: ${mastery}% mastery. ${recommended_mode === "Autopilot" ? "We recommend Autopilot to guide your schedule." : "You can use Coach mode for more control."}`,
    time_to_mastery_minutes: mastery < 60 ? 120 : mastery < 85 ? 60 : 30,
    careless_patterns: [],
  };
}

// --- JSON extraction (same strategy as diagnostic: by key, not first "{") ---

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

/** Extract JSON object containing the given key (e.g. "mastery_percent"). Avoids first "{" which can be LaTeX. */
function extractJsonByKey(text: string, key: string): string | null {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) raw = fenced[1].trim();
  const keyIndex = raw.indexOf(`"${key}"`);
  if (keyIndex === -1) return null;
  const braceIndex = raw.lastIndexOf("{", keyIndex - 1);
  if (braceIndex === -1) return null;
  const end = findMatchingEnd(raw, braceIndex);
  if (end === -1) return null;
  return raw.slice(braceIndex, end);
}

function sanitizeJsonString(s: string): string {
  let out = s.trim().replace(/\uFEFF/g, "");
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return out;
}

export async function POST(req: Request) {
  const startMs = Date.now();
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

  const difficulty = body.difficulty ?? "Medium";
  const deterministic = computeDeterministicMastery(
    body.questions,
    body.answers,
    difficulty
  );
  const base = deterministic.base_mastery_percent.toFixed(1);
  const inputJson = JSON.stringify({
    questions: body.questions.map((q) => ({
      id: q.id,
      type: q.type,
      concept_tag: q.concept_tag ?? "topic",
      answer_key: q.answer_key,
    })),
    answers: body.answers,
  });

  const systemContent =
    "Return ONLY valid JSON. No markdown. No <think>. No explanation. Single JSON object with keys: mastery_percent, weaknesses, recommended_mode, mode_reasoning, time_to_mastery_minutes. Optionally: predicted_score (today, after_7_days, after_fixing_top3), strong_learner, micro_patterns.";

  const userPrompt = `Analyze diagnostic answers. Output a single JSON object. Base mastery anchor: ${base}. mastery_percent must be 0-100 (within ±10 of ${base}). weaknesses: array of 3-5 items, each { concept_tag, severity, evidence, fix_suggestion }. recommended_mode: "Autopilot" if mastery < 65 else "Coach". mode_reasoning: max 2 sentences. time_to_mastery_minutes: 15-300. predicted_score: { today, after_7_days, after_fixing_top3 } each 0-99. Input: ${inputJson}`;

  let rawText: string;
  try {
    rawText = await chatComplete({
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userPrompt },
      ],
      maxTokens: MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      /aborted|AbortError/i.test(message) ||
      (err instanceof Error && err.name === "AbortError");
    if (isTimeout) {
      const fallback = getFallbackAnalysis(body.questions, body.answers, difficulty);
      return NextResponse.json(
        { ...fallback, meta: { source: "fallback", reason: "timeout", durationMs } },
        { status: 200 }
      );
    }
    const fallback = getFallbackAnalysis(body.questions, body.answers, difficulty);
    return NextResponse.json(
      { ...fallback, meta: { source: "fallback", reason: "error", durationMs } },
      { status: 200 }
    );
  }

  const durationMs = Date.now() - startMs;
  const content = typeof rawText === "string" ? rawText : "";

  const jsonStr =
    extractJsonByKey(content, "mastery_percent") ??
    extractJsonByKey(content, "weaknesses") ??
    extractJsonByKey(content, "result");
  if (jsonStr === null) {
    console.error("[analyze-answers] No expected key found. Snippet:", content.slice(0, 400));
    const fallback = getFallbackAnalysis(body.questions, body.answers, difficulty);
    return NextResponse.json(
      { ...fallback, meta: { source: "fallback", reason: "no_key", durationMs } },
      { status: 200 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonString(jsonStr));
  } catch (err) {
    console.error("[analyze-answers] JSON parse error:", err);
    const fallback = getFallbackAnalysis(body.questions, body.answers, difficulty);
    return NextResponse.json(
      { ...fallback, meta: { source: "fallback", reason: "parse", durationMs } },
      { status: 200 }
    );
  }

  const result = OutputSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[analyze-answers] Validation failed:", result.error.issues);
    const fallback = getFallbackAnalysis(body.questions, body.answers, difficulty);
    return NextResponse.json(
      { ...fallback, meta: { source: "fallback", reason: "validation", durationMs } },
      { status: 200 }
    );
  }

  const response = {
    ...result.data,
    careless_patterns: result.data.micro_patterns?.careless_mistake_patterns ?? [],
    meta: { source: "ai" as const, durationMs },
  };
  return NextResponse.json(response);
}
