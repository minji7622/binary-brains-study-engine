import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject, zodSchema } from "ai";
import { minimax } from "vercel-minimax-ai-provider";

const BodySchema = z.object({
  subject: z.string().min(1),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  examDate: z.string().optional(),
  mode: z.enum(["Autopilot", "Coach"]).optional(),
});

const OutputSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["mcq", "short"]),
        question_md: z.string(),
        choices_md: z.array(z.string()).optional(),
        answer_key: z.string().nullable().optional(),
        concept_tag: z.string().nullable().optional(),
      })
    )
    .length(7),
});

/** Strip leading non-JSON (e.g. "python\\n") and extract a single top-level JSON object. */
function repairJson(text: string): string | null {
  const raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  if (start > 0) candidate = candidate.slice(start);
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

    const prompt = `Generate exactly 7 diagnostic questions for subject: ${body.subject}, difficulty: ${body.difficulty}.
Mix: 4 MCQ + 3 short-answer. Diagnose misconceptions.
Rules: Each question has id (q1-q7), type ("mcq" or "short"), question_md (string; use $...$ for math). MCQ only: choices_md array of 4 strings starting with "A)","B)","C)","D)"; answer_key "A"|"B"|"C"|"D". concept_tag optional.`;

    const result = await generateObject({
      model: minimax("MiniMax-Text-01"),
      schema: zodSchema(OutputSchema),
      schemaName: "DiagnosticQuestions",
      schemaDescription: "Exactly 7 diagnostic questions (4 MCQ + 3 short-answer).",
      prompt,
      temperature: 0.4,
      experimental_repairText: ({ text }) => Promise.resolve(repairJson(text)),
    });

    return NextResponse.json(result.object);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to generate diagnostic", detail: message },
      { status: 400 }
    );
  }
}