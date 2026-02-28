import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject, generateText, zodSchema } from "ai";
import { minimax } from "vercel-minimax-ai-provider";

const BodySchema = z
  .object({
    subject: z.string(),
    difficulty: z.enum(["Easy", "Medium", "Hard", "easy", "medium", "hard"]),
    examDate: z.string().optional(),
    mode: z.enum(["Autopilot", "Coach", "autopilot", "coach"]).optional(),
    count: z.number().int().min(1).max(7).optional(),
  })
  .transform((data) => ({
    ...data,
    subject: data.subject.trim(),
    difficulty:
      data.difficulty.charAt(0).toUpperCase() +
      data.difficulty.slice(1).toLowerCase(),
    mode: data.mode
      ? data.mode.charAt(0).toUpperCase() + data.mode.slice(1).toLowerCase()
      : undefined,
  }))
  .refine((data) => data.subject.length > 0, {
    message: "Subject name required",
    path: ["subject"],
  });

const QuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["mcq", "short"]),
  question_md: z.string(),
  choices_md: z.array(z.string()).optional(),
  answer_key: z.string().nullable().optional(),
  concept_tag: z.string().nullable().optional(),
});

const OutputSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(7),
});

/** If text contains ```json, strip it. Extract first {...} block via regex then brace-match to a single object. */
function extractJsonBlock(text: string): string | null {
  const raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = fenced ? fenced[1].trim() : raw;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return null;
  candidate = match[0];
  let depth = 0;
  let end = -1;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end > 0) candidate = candidate.slice(0, end);
  return candidate;
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);
    const count = body.count ?? 7;

    const mix =
      count === 7
        ? "4 MCQ, 3 short-answer"
        : count === 4
          ? "2 MCQ, 2 short-answer"
          : "2 MCQ, 1 short-answer";
    const importantBlock = `
IMPORTANT:
- Return ONLY raw JSON.
- Do NOT wrap in markdown.
- Do NOT include explanations.
- Output MUST be valid JSON.
- The root object must contain:
{
  "questions": [
    { id, type, question, choices?, answer_key?, concept_tag }
  ]
}
- Exactly 7 questions.
- No trailing commas.`;

    const prompt = `Subject: ${body.subject}. Difficulty: ${body.difficulty}. Generate exactly ${count} diagnostic questions: ${mix}. Use ids q1–q${count}. Diagnose misconceptions.
Concise only: Each question max 1–2 sentences. Each choice max 8 words. No explanations. concept_tag <= 2 words, snake_case. Provide answer_key only for MCQ. Use $...$ for math in question_md.${importantBlock}`;

    const shortPrompt = `Subject: ${body.subject}. Difficulty: ${body.difficulty}. Return a JSON object with key "questions": array of exactly ${count} objects. Each object: id (q1-q${count}), type ("mcq" or "short"), question_md (string), choices_md (array for mcq only), answer_key (for mcq), concept_tag (optional). Raw JSON only, no markdown, no trailing commas.${importantBlock}`;

    let parsed: z.infer<typeof OutputSchema>;

    function parseAndValidate(text: string): z.infer<typeof OutputSchema> | null {
      const block = extractJsonBlock(text);
      if (!block) return null;
      try {
        const raw = JSON.parse(block) as { questions?: Array<Record<string, unknown>> };
        if (raw.questions) {
          raw.questions = raw.questions.map((q) => ({
            ...q,
            question_md: q.question_md ?? q.question,
          }));
        }
        return OutputSchema.parse(raw);
      } catch {
        return null;
      }
    }

    try {
      const result = await generateObject({
        model: minimax("MiniMax-Text-01"),
        schema: zodSchema(OutputSchema),
        schemaName: "DiagnosticQuestions",
        schemaDescription: `${count} questions (${mix}). Concise: question 1–2 sentences, choice max 8 words, concept_tag ≤2 words snake_case, answer_key only for MCQ. Ids q1–q${count}.`,
        prompt,
        temperature: 0.3,
        maxOutputTokens: 800,
        experimental_repairText: ({ text }) =>
          Promise.resolve(extractJsonBlock(text)),
      });
      parsed = result.object as z.infer<typeof OutputSchema>;
    } catch (objectErr: unknown) {
      const msg = objectErr instanceof Error ? objectErr.message : String(objectErr);
      const isNoResponse =
        /did not return a response|No object generated/i.test(msg);

      if (!isNoResponse) {
        throw objectErr;
      }

      const textResult = await generateText({
        model: minimax("MiniMax-Text-01"),
        prompt: `${prompt}\n\nRespond with ONLY a JSON object. No other text.`,
        temperature: 0.3,
        maxOutputTokens: 800,
      });

      let fallback = parseAndValidate(textResult.text);
      if (!fallback) {
        const retryResult = await generateText({
          model: minimax("MiniMax-Text-01"),
          prompt: shortPrompt,
          temperature: 0.2,
          maxOutputTokens: 800,
        });
        fallback = parseAndValidate(retryResult.text);
        if (!fallback) {
          return NextResponse.json(
            {
              error: "Failed to generate diagnostic",
              detail:
                "The model did not return valid questions. Please try again or click Regenerate.",
            },
            { status: 500 }
          );
        }
      }
      parsed = fallback;
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const issues = "issues" in err ? (err as { issues: Array<{ message: string }> }).issues : [];
      const detail = issues.length > 0 ? issues.map((e) => e.message).join("; ") : err.message;
      return NextResponse.json(
        { error: "Failed to generate diagnostic", detail },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Failed to generate diagnostic",
        detail:
          message.includes("did not return a response") ||
          message.includes("No object generated")
            ? "The model didn't return questions. Please try again or click Regenerate."
            : message,
      },
      { status: 400 }
    );
  }
}