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
        question: z.string(),
        choices: z.array(z.string()).optional(),
        answer_key: z.string().optional(),
        concept_tag: z.string().optional(),
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
You are an expert tutor creating a diagnostic mini-test.
Return ONLY raw JSON. Do NOT include markdown, backticks, or any commentary.
Return ONLY valid JSON matching this schema:
{
  "questions": [
    {
      "id": "q1",
      "type": "mcq" | "short",
      "question": "...",
      "choices": ["A", "B", "C", "D"],   // only if type is mcq
      "answer_key": "..."               // optional
      "concept_tag": "..."              // short tag like "chain_rule" or "stoichiometry"
    }
  ]
}

Rules:
- Generate exactly 7 questions for subject: ${body.subject}
- Difficulty: ${body.difficulty}
- Mix: 4 MCQ + 3 short-answer
- Questions should diagnose common misconceptions (not trivial recall)
- Keep each question concise.
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