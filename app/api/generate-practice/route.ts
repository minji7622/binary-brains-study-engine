import { NextResponse } from "next/server";
import { z } from "zod";
import { minimax } from "vercel-minimax-ai-provider";
import { generateJsonWithGuard } from "@/app/lib/llmJson";

const BodySchema = z.object({
  subject: z.string().trim().min(1, "Subject required"),
  strong_learner: z.boolean(),
  weaknesses: z
    .array(
      z.object({
        concept_tag: z.string(),
        severity: z.enum(["high", "medium", "low"]).optional(),
      })
    )
    .optional(),
});

const PracticeItemSchema = z.object({
  id: z.string(),
  type: z.enum(["mcq", "short"]),
  question_md: z.string(),
  choices_md: z.array(z.string()).optional(),
  answer_key: z.string().nullable().optional(),
  concept_tag: z.string().nullable().optional(),
});

const OutputSchema = z.object({
  questions: z.array(PracticeItemSchema).length(6),
});

const PRACTICE_TIMEOUT_MS = 15_000;

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);

    const difficultyRule =
      body.strong_learner
        ? "Exactly 2 items must be Hard (mixed-topic, challenging). The other 4 must be Medium."
        : "All 6 items Medium difficulty, or 4 Medium and 2 Easy.";

    const prompt = `Generate practice questions. JSON only. No markdown, no explanation.

Subject: ${body.subject}. ${difficultyRule}

Output exactly 6 items. Each item:
- id: "p1" through "p6"
- type: "mcq" or "short"
- question_md: max 2 sentences. Use $...$ for math.
- choices_md: only for mcq, max 10 words per choice
- answer_key: only for mcq (e.g. "A")
- concept_tag: optional, short

Schema: { "questions": [ { "id", "type", "question_md", "choices_md" (if mcq), "answer_key" (if mcq), "concept_tag" } ] }
No extra fields. Raw JSON only.${body.weaknesses?.length ? ` Focus areas: ${body.weaknesses.map((w) => w.concept_tag).join(", ")}.` : ""}`;

    const shortPrompt = `JSON only. Subject: ${body.subject}. 6 items: id p1-p6, type mcq|short, question_md (≤2 sentences), choices_md ≤10 words each (mcq only), answer_key (mcq only), concept_tag optional. ${body.strong_learner ? "2 Hard mixed-topic, 4 Medium." : "6 Medium or 4 Medium + 2 Easy."} Raw JSON.`;

    const parsed = await generateJsonWithGuard({
      model: minimax("MiniMax-Text-01"),
      prompt,
      schema: OutputSchema,
      maxTokens: 850,
      temperature: 0.3,
      timeoutMs: PRACTICE_TIMEOUT_MS,
      retries: 1,
      retryOnceWithPrompt: shortPrompt,
      normalize: (raw) => {
        const r = raw as { questions?: Array<Record<string, unknown>> };
        if (r?.questions) {
          r.questions = r.questions.slice(0, 6).map((q, i) => ({
            id: q.id ?? `p${i + 1}`,
            type: q.type ?? "mcq",
            question_md: q.question_md ?? q.question ?? "",
            choices_md: q.choices_md ?? q.choices ?? undefined,
            answer_key: q.answer_key ?? null,
            concept_tag: q.concept_tag ?? null,
          }));
        }
        return r;
      },
    });

    const normalized = {
      questions: parsed.questions.map((q, i) => ({
        id: q.id || `p${i + 1}`,
        type: q.type,
        question_md: q.question_md,
        choices_md: q.choices_md ?? [],
        answer_key: q.answer_key ?? undefined,
        concept_tag: q.concept_tag ?? undefined,
      })),
    };
    return NextResponse.json(normalized);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const issues =
        "issues" in err
          ? (err as { issues: Array<{ message: string }> }).issues
          : [];
      const detail =
        issues.length > 0
          ? issues.map((e) => e.message).join("; ")
          : err.message;
      return NextResponse.json(
        { error: "Failed to generate practice", detail },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    const isInvalidJson =
      message.includes("did not return valid JSON") ||
      message.includes("did not return a response") ||
      message.includes("No object generated");
    return NextResponse.json(
      {
        error: "Failed to generate practice",
        detail: isInvalidJson
          ? "The model didn't return valid practice questions. Please try again."
          : message,
      },
      { status: isInvalidJson ? 500 : 400 }
    );
  }
}
