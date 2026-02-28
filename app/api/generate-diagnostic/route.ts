import { NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
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

function extractJson(text: string) {
    // Remove ```json ... ``` or ``` ... ```
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1] : text;
  
    // Trim and return
    return candidate.trim();
  }

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);

    const prompt = `
Return ONLY raw JSON (no markdown fences, no commentary).
All math MUST be wrapped in $...$ (inline) or $$...$$ (block).
Use these exact keys: id, type, question_md, choices_md (if mcq), answer_key (optional), concept_tag (optional).

JSON schema:
{
  "questions": [
    {
      "id": "q1",
      "type": "mcq" | "short",
      "question_md": "string (may include $math$)",
      "choices_md": ["A) ...", "B) ...", "C) ...", "D) ..."], // only if mcq
      "answer_key": "A" | "B" | "C" | "D", // only if mcq, optional otherwise
      "concept_tag": "short_tag"
    }
  ]
}

Generate exactly 7 questions for:
- subject: ${body.subject}
- difficulty: ${body.difficulty}

Mix: 4 MCQ + 3 short-answer.
Questions should diagnose misconceptions.

Important:
- For MCQ, choices_md must be exactly 4 strings starting with "A)","B)","C)","D)".
- Keep questions concise.
`;
    const result = await generateText({
      model: minimax("MiniMax-Text-01"),
      prompt,
      temperature: 0.4,
    });

    // Parse and validate JSON
    const cleaned = extractJson(result.text);
    const parsed = OutputSchema.parse(JSON.parse(cleaned));
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to generate diagnostic", detail: String(err?.message ?? err) },
      { status: 400 }
    );
  }
}