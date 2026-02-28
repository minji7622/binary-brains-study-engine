import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject, generateText, zodSchema } from "ai";
import { minimax } from "vercel-minimax-ai-provider";

const WeaknessInputSchema = z.object({
  concept_tag: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  evidence: z.string().optional(),
  fix_suggestion: z.string().optional(),
  description: z.string().optional(),
});

const BodySchema = z.object({
  subject: z.string().trim().min(1, "Subject required"),
  mastery_percent: z.number().min(0).max(100),
  weaknesses: z.array(WeaknessInputSchema),
  dailyHours: z.number().min(0.1).max(24),
  examDate: z.string(),
  mode: z.enum(["autopilot", "coach"]),
});

const DaySchema = z.object({
  day: z.number().int().min(1).max(7),
  focus: z.string(),
  hours: z.number().min(0),
  method: z.string(),
});

const OutputSchema = z.object({
  days: z.array(DaySchema).length(7),
  strategy_summary: z.string(),
  rationale: z.string(),
});

/** Strip markdown fences and extract first {...} block via brace-matching. */
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

function normalizePlan(
  parsed: z.infer<typeof OutputSchema>,
  dailyHours: number
): z.infer<typeof OutputSchema> {
  const sorted = [...parsed.days].sort((a, b) => a.day - b.day);
  const days = sorted.slice(0, 7).map((d, i) => ({
    ...d,
    day: i + 1,
    hours: Math.min(d.hours, dailyHours),
  }));
  return { ...parsed, days };
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = BodySchema.parse(json);
    const dailyHours = body.dailyHours;

    const importantBlock = `
IMPORTANT:
- Return ONLY raw JSON. No markdown fences. No explanations outside JSON.
- Output MUST be valid JSON with exactly these keys: "days", "strategy_summary", "rationale".
- "days" must be an array of exactly 7 objects. Each object: "day" (1-7), "focus" (string), "hours" (number), "method" (string).
- For every day, hours must be <= ${dailyHours}. No trailing commas.`;

    const autopilotInstructions = `
Mode: autopilot. Generate a structured, time-blocked, strict daily plan.
- Allocate exact hours per weakness by severity (high/medium/low).
- Each day: precise time blocks, exact hours.`;

    const coachInstructions = `
Mode: coach. Generate flexible focus recommendations.
- Encourage autonomy. Suggest time ranges, not strict blocks.
- method: short recommendation (e.g. "1–2h practice problems", "30–45 min review").`;

    const modeBlock =
      body.mode === "autopilot" ? autopilotInstructions : coachInstructions;

    const prompt = `Subject: ${body.subject}. Exam date: ${body.examDate}. Mastery: ${body.mastery_percent}%. Daily hours cap: ${dailyHours}h.
Weaknesses (use these to assign focus and method): ${JSON.stringify(body.weaknesses)}
${modeBlock}
Output a 7-day plan. Exactly 7 days, day 1 to day 7. Each day: day (1-7), focus (what to study), hours (number <= ${dailyHours}), method (how). Also strategy_summary (short) and rationale (short).${importantBlock}`;

    const shortPrompt = `Subject: ${body.subject}. dailyHours: ${dailyHours}. Return JSON only: { "days": [ 7 objects with day, focus, hours, method ], "strategy_summary": "...", "rationale": "..." }. Each day hours <= ${dailyHours}. Raw JSON, no markdown.${importantBlock}`;

    type Output = z.infer<typeof OutputSchema>;

    function parseAndValidate(text: string): Output | null {
      const block = extractJsonBlock(text);
      if (!block) return null;
      try {
        const raw = JSON.parse(block);
        return OutputSchema.parse(raw);
      } catch {
        return null;
      }
    }

    let parsed: Output;

    try {
      const result = await generateObject({
        model: minimax("MiniMax-Text-01"),
        schema: zodSchema(OutputSchema),
        schemaName: "StudyPlan",
        schemaDescription: `7-day plan: days array (day 1-7, focus, hours <= ${dailyHours}, method), strategy_summary, rationale.`,
        prompt,
        temperature: 0.3,
        maxOutputTokens: 1000,
        experimental_repairText: ({ text }) =>
          Promise.resolve(extractJsonBlock(text)),
      });
      parsed = result.object as Output;
    } catch (objectErr: unknown) {
      const msg =
        objectErr instanceof Error ? objectErr.message : String(objectErr);
      const isNoResponse =
        /did not return a response|No object generated/i.test(msg);

      if (!isNoResponse) throw objectErr;

      const textResult = await generateText({
        model: minimax("MiniMax-Text-01"),
        prompt: `${prompt}\n\nRespond with ONLY a JSON object. No other text.`,
        temperature: 0.3,
        maxOutputTokens: 1000,
      });

      let fallback = parseAndValidate(textResult.text);
      if (!fallback) {
        const retryResult = await generateText({
          model: minimax("MiniMax-Text-01"),
          prompt: shortPrompt,
          temperature: 0.2,
          maxOutputTokens: 1000,
        });
        fallback = parseAndValidate(retryResult.text);
        if (!fallback) {
          return NextResponse.json(
            {
              error: "Failed to generate plan",
              detail:
                "The model did not return a valid plan. Please try again.",
            },
            { status: 500 }
          );
        }
      }
      parsed = fallback;
    }

    const normalized = normalizePlan(parsed, dailyHours);
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
        { error: "Failed to generate plan", detail },
        { status: 400 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Failed to generate plan",
        detail:
          message.includes("did not return a response") ||
          message.includes("No object generated")
            ? "The model didn't return a plan. Please try again."
            : message,
      },
      { status: 400 }
    );
  }
}
