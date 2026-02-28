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
});

const WeaknessSchema = z.object({
  concept_tag: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  description: z.string().optional(),
});

const OutputSchema = z.object({
  mastery_percent: z.number().min(0).max(100),
  weaknesses: z.array(WeaknessSchema),
  predicted_score_today: z.number().min(0).max(100).optional(),
  predicted_score_after_7_days: z.number().min(0).max(100).optional(),
  recommended_mode: z.enum(["Autopilot", "Coach"]),
  mode_reasoning: z.string(),
});

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  return candidate.trim();
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);

    const prompt = `You are analyzing diagnostic answers. Return ONLY raw JSON (no markdown fences, no commentary).

Input: 7 questions (each with id, type, question_md, choices_md if mcq, answer_key if mcq, concept_tag) and 7 user answers (each with answer string and noIdea boolean).

Tasks:
1. Score each question: for MCQ compare user answer to answer_key (e.g. "A" or first letter of correct choice); for short answer use judgment. Mark "no idea" responses as wrong.
2. Compute mastery_percent (0-100): percentage of questions answered correctly.
3. List weaknesses: for each wrong or "no idea" question, add an object with concept_tag (from question or inferred), severity ("high" | "medium" | "low"), and optional short description.
4. Optionally set predicted_score_today and predicted_score_after_7_days (0-100) if you can estimate.
5. Set recommended_mode and mode_reasoning using these rules exactly:
   - If mastery_percent < 65 → recommend "Autopilot"
   - If mastery_percent >= 85 → recommend "Coach"
   - If 65 <= mastery_percent < 85:
     - If multiple high-severity weaknesses OR many "no idea" responses → recommend "Autopilot"
     - Else → recommend "Coach"
   - mode_reasoning: 2-3 short, student-facing sentences explaining why this mode is recommended. Be concise and encouraging.

Output JSON schema (use these exact keys):
{
  "mastery_percent": number,
  "weaknesses": [ { "concept_tag": string, "severity": "high"|"medium"|"low", "description": string (optional) } ],
  "predicted_score_today": number (optional),
  "predicted_score_after_7_days": number (optional),
  "recommended_mode": "Autopilot" | "Coach",
  "mode_reasoning": "string, 2-3 sentences"
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
