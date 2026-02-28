import { NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { minimax } from "vercel-minimax-ai-provider";

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
  evidence: z.string(), // Q IDs e.g. "q1, q3"
  fix_suggestion: z.string(),
  description: z.string().optional(),
});

const OutputSchema = z.object({
  mastery_percent: z.number().min(0).max(100),
  weaknesses: z.array(WeaknessSchema),
  micro_patterns: z
    .object({
      careless_mistake_patterns: z.array(z.string()).optional(),
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

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  return candidate.trim();
}

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
      const correct = (q.answer_key ?? "").toString().trim();
      const given = (a.answer ?? "").toString().trim();
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

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);
    const difficulty = body.difficulty ?? "Medium";

    const deterministic = computeDeterministicMastery(
      body.questions,
      body.answers,
      difficulty
    );

    const prompt = `You are analyzing diagnostic answers. Return ONLY raw JSON (no markdown fences, no commentary).

Pre-computed deterministic metrics:
- base_mastery_percent: ${deterministic.base_mastery_percent.toFixed(1)}
- total_noIdea: ${deterministic.total_noIdea}
- total_correct_mcq / total_mcq: ${deterministic.total_correct_mcq} / ${deterministic.total_mcq}
- short_answer_attempts: ${deterministic.short_answer_attempts}

MASTERY RULES (strict):
- Treat base_mastery_percent as the primary anchor. You may adjust mastery_percent by at most ±10% from base_mastery_percent.
- Do NOT produce large jumps. Final mastery_percent must remain within ±10% of base_mastery_percent (i.e. between base_mastery_percent - 10 and base_mastery_percent + 10, clamped to 0–100).
- Any upward or downward adjustment must be justified by: conceptual gaps in short answers, repeated concept_tag failures across questions, or high total_noIdea. State reasoning in your internal logic; output only the number.
- Final mastery_percent must be in range 0–100.

Input: 7 questions (each with id, type, question_md, choices_md if mcq, answer_key if mcq, concept_tag) and 7 user answers (each with answer string and noIdea boolean).

Tasks:
1. Score each question: for MCQ compare user answer to answer_key (e.g. "A" or first letter of correct choice); for short answer use judgment. Mark "no idea" responses as wrong.
2. Set mastery_percent: anchor to base_mastery_percent; you may adjust by at most ±10% based on conceptual gaps, repeated concept_tag failures, or high noIdea. Output must be 0–100 and within ±10% of base_mastery_percent.
3. Detect micro-patterns (concise, structured): identify careless_mistake_patterns (e.g. misread stem, sign errors, rushed choices) and conceptual_blind_spots (recurring misunderstandings). Output as arrays of short strings in micro_patterns.
4. List weaknesses: for each wrong or "no idea" question, add an object with concept_tag, severity ("high"|"medium"|"low"), evidence (specific Q IDs e.g. "q1, q3"), and fix_suggestion (concrete, actionable). Keep each entry concise. If mastery_percent >= 85: set strong_learner = true and focus weaknesses on refinement and optimization (e.g. precision, edge cases) rather than fundamentals.
5. Set strong_learner: true if mastery_percent >= 85, else false. When true, weakness list should emphasize refinement/optimization, not basics.
6. Set predicted_score (required): { "today": number, "after_7_days": number, "after_fixing_top3": number }. Cap each at 99 (never 100). today ≈ mastery_percent (±3%). after_7_days = estimate assuming structured study. after_fixing_top3 = score if they fix top 3 weaknesses; show meaningful improvement when severe weaknesses exist.
7. Set recommended_mode and mode_reasoning using these rules exactly:
   - If mastery_percent < 65 → recommend "Autopilot"
   - If mastery_percent >= 85 → recommend "Coach"
   - If 65 <= mastery_percent < 85:
     - If multiple high-severity weaknesses OR many "no idea" responses → recommend "Autopilot"
     - Else → recommend "Coach"
   - mode_reasoning: 2-3 short, student-facing sentences. Be concise and encouraging.
8. Set time_to_mastery_minutes: estimate minutes to 90–95% mastery with a focused plan. Integer. Range 15–300.

Output JSON schema (use these exact keys):
{
  "mastery_percent": number,
  "weaknesses": [ { "concept_tag": string, "severity": "high"|"medium"|"low", "evidence": "string (Q IDs)", "fix_suggestion": "string" } ],
  "micro_patterns": { "careless_mistake_patterns": string[], "conceptual_blind_spots": string[] } (optional),
  "strong_learner": boolean,
  "predicted_score": { "today": number, "after_7_days": number, "after_fixing_top3": number },
  "recommended_mode": "Autopilot" | "Coach",
  "mode_reasoning": "string",
  "time_to_mastery_minutes": integer
}

Input data:
${JSON.stringify({ questions: body.questions, answers: body.answers })}`;

    const result = await generateText({
      model: minimax("MiniMax-Text-01"),
      prompt,
      temperature: 0.2,
    });

    const cleaned = extractJson(result.text);
    const parsed = OutputSchema.parse(JSON.parse(cleaned));
    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to analyze answers", detail: message },
      { status: 400 }
    );
  }
}
