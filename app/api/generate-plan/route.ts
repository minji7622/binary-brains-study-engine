import { NextResponse } from "next/server";
import { z } from "zod";
import { chatComplete } from "@/app/lib/llm";

// --- Input -------------------------------------------------------------------

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
  subjects: z
    .array(
      z.object({
        name: z.string(),
        examDate: z.string(),
        difficulty: z.string().optional(),
      })
    )
    .optional(),
  projectDeadlines: z
    .array(
      z.object({
        title: z.string(),
        dueDate: z.string(),
      })
    )
    .optional(),
});

// --- Output (specific, non-repetitive, no snake_case) -------------------------

const TimeBlockSchema = z.object({
  label: z.string().min(2),
  minutes: z.number().int().min(5).max(120),
  task: z.string().min(5),
  deliverable: z.string().min(5),
});

const DaySchema = z.object({
  day: z.number().int().min(1).max(7),
  focus_title: z.string().min(3),
  time_blocks: z.array(TimeBlockSchema).min(2).max(4),
  deliverables: z.array(z.string()).min(2).max(4),
  notes: z.string().min(5),
});

const OutputSchema = z
  .object({
    days: z.array(DaySchema).length(7),
    strategy_summary: z.string().min(10),
    rationale: z.string().min(10),
  })
  .refine(
    (data) => {
      const lines = data.strategy_summary.trim().split(/\n/).filter(Boolean);
      return lines.length >= 1 && lines.length <= 3;
    },
    { message: "strategy_summary must be max 3 lines" }
  )
  .refine(
    (data) => {
      const reviewLike = /review|mistakes|recall|revisit|errors/i;
      const daysWithReview = data.days.filter(
        (d) =>
          reviewLike.test(d.focus_title) ||
          reviewLike.test(d.notes) ||
          d.time_blocks.some((b) => reviewLike.test(b.task) || reviewLike.test(b.label))
      );
      return daysWithReview.length >= 2;
    },
    { message: "At least 2 days must be review days (reference previous mistakes)" }
  )
  .refine(
    (data) => {
      const mixedLike = /mixed|integration|combined|cross-topic|multi-topic/i;
      return data.days.some(
        (d) =>
          mixedLike.test(d.focus_title) ||
          mixedLike.test(d.notes) ||
          d.time_blocks.some((b) => mixedLike.test(b.label) || mixedLike.test(b.task))
      );
    },
    { message: "At least 1 day must include mixed-topic integration" }
  )
  .refine(
    (data) => {
      const mockLike = /mini-mock|time-pressure|timed|mock|under time/i;
      return data.days.some((d) =>
        d.time_blocks.some((b) => mockLike.test(b.label) || mockLike.test(b.task))
      );
    },
    { message: "At least 1 time block must be mini-mock or time-pressure" }
  )
  .refine(
    (data) => {
      const allDeliverables = data.days.flatMap((d) => d.deliverables);
      const unique = new Set(allDeliverables.map((s) => s.trim().toLowerCase()));
      return unique.size === allDeliverables.length;
    },
    { message: "deliverables must not be duplicated across days" }
  );

const PLAN_TIMEOUT_MS = 15_000;
const MAX_TOKENS = 680;

// --- JSON extraction (same pattern as diagnostic/analyze) ----------------------

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

// --- Helpers for dates (7 days from today, local) ----------------------------

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNext7Dates(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    out.push(toLocalDateString(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// --- Fallback plan (deterministic, new schema) --------------------------------

type FallbackInput = {
  dailyHours: number;
  selectedSubjectName: string;
  weaknessTags: string[];
  subjects: { name: string; examDate: string }[];
  projectDeadlines: { title: string; dueDate: string }[];
  mode: "autopilot" | "coach";
};

function tagToNatural(tag: string): string {
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const BLOCK_LABELS = ["Core practice", "Concept rebuild", "Mixed review", "Mini mock", "Quick recall", "Drill", "Error review"] as const;

function getFallbackPlan(input: FallbackInput): z.infer<typeof OutputSchema> {
  const topics = input.weaknessTags.length > 0 ? input.weaknessTags.map(tagToNatural) : [input.selectedSubjectName];
  const days: z.infer<typeof DaySchema>[] = [];
  const usedDeliverables = new Set<string>();

  const uniqueDeliverable = (prefix: string, dayIdx: number): string => {
    const t = topics[dayIdx % topics.length] || input.selectedSubjectName;
    const cand = `${prefix}: ${t} (Day ${dayIdx + 1})`;
    if (usedDeliverables.has(cand)) return `${prefix}: ${t} set B (Day ${dayIdx + 1})`;
    usedDeliverables.add(cand);
    return cand;
  };

  for (let i = 1; i <= 7; i++) {
    const dayIdx = i - 1;
    const isReviewDay = i === 3 || i === 6;
    const isMixedDay = i === 5;
    const topic = topics[dayIdx % topics.length] || input.selectedSubjectName;
    const focusTitle = isReviewDay
      ? "Review and Revisit Mistakes"
      : isMixedDay
        ? "Mixed Topic Integration"
        : `${topic} Focus`;
    const mins = [25, 35, 20, 15, 30, 40, 18];
    const time_blocks: z.infer<typeof TimeBlockSchema>[] = [
      {
        label: BLOCK_LABELS[dayIdx % BLOCK_LABELS.length],
        minutes: mins[dayIdx % mins.length],
        task: isReviewDay
          ? `Revisit errors from previous days; rework 2–3 weak areas.`
          : `Work through 8–10 ${topic} questions; annotate steps.`,
        deliverable: uniqueDeliverable("Complete set", dayIdx),
      },
      {
        label: dayIdx === 4 ? "Mini mock" : "Concept rebuild",
        minutes: dayIdx === 4 ? 25 : 20,
        task: dayIdx === 4 ? "Timed set under 25 min; no pause." : "Rebuild one concept with 4–5 worked examples.",
        deliverable: uniqueDeliverable("Deliverable", dayIdx),
      },
    ];
    if (i <= 4) time_blocks.push({ label: "Quick recall", minutes: 15, task: "Recall key formulas and one pitfall.", deliverable: uniqueDeliverable("Notes", dayIdx) });

    const deliverables = [
      uniqueDeliverable("Finish questions", dayIdx),
      uniqueDeliverable("Mark mistakes", dayIdx),
    ];
    const notes = isReviewDay
      ? "Today prioritises fixing past errors before new content."
      : isMixedDay
        ? "Combine two topics in one session to build connections."
        : `Focused block on ${topic}; vary question types.`;
    days.push({ day: i, focus_title: focusTitle, time_blocks, deliverables, notes });
  }

  return {
    days,
    strategy_summary: "Focus on weak topics with concrete task counts. Two review days and one mixed-topic day. One mini-mock block.",
    rationale: "Priorities from diagnostic weaknesses. Spaced repetition; no duplicate deliverables across days.",
  };
}

// --- Derive backward-compat shape for existing UI -----------------------------

function toLegacyDays(days: z.infer<typeof DaySchema>[]): { day: number; focus: string; hours: number; method: string }[] {
  return days.slice(0, 7).map((d) => {
    const totalMins = d.time_blocks.reduce((s, b) => s + b.minutes, 0);
    const hours = Math.round((totalMins / 60) * 10) / 10;
    const method = d.time_blocks.map((b) => b.label).slice(0, 2).join(", ") || "Study";
    return {
      day: d.day,
      focus: d.focus_title || "Study",
      hours,
      method,
    };
  });
}

// --- Handler ------------------------------------------------------------------

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

  const subjects = body.subjects?.length
    ? body.subjects
    : [{ name: body.subject, examDate: body.examDate, difficulty: "Medium" }];
  const projectDeadlines = body.projectDeadlines ?? [];
  const weaknessTags = body.weaknesses.map((w) => w.concept_tag).filter(Boolean);
  const fallbackInput: FallbackInput = {
    dailyHours: body.dailyHours,
    selectedSubjectName: body.subject,
    weaknessTags,
    subjects: subjects.map((s) => ({ name: s.name, examDate: s.examDate })),
    projectDeadlines,
    mode: body.mode,
  };

  const systemContent =
    "Return ONLY valid JSON. No markdown. No <think>. No explanation. Single JSON object with top-level key \"days\".";

  const weaknessNatural = body.weaknesses.map((w) => tagToNatural(w.concept_tag));
  const inputForPrompt = {
    subjects: subjects.map((s) => ({ name: s.name, examDate: s.examDate, difficulty: s.difficulty })),
    projectDeadlines,
    dailyHours: body.dailyHours,
    selectedSubject: body.subject,
    insights: {
      mastery_percent: body.mastery_percent,
      weaknessTopics: weaknessNatural,
    },
    mode: body.mode,
  };

  const userPrompt = `Generate a specific, realistic, non-repetitive 7-day study plan. Use natural language only (no snake_case). Convert concept tags to readable titles (e.g. chain_rule → "Chain rule").

Consider: ALL subjects and exam dates, project deadlines, daily cap ${body.dailyHours}h, and weaknesses: ${weaknessNatural.join(", ") || "none"}.

Output a single JSON object with keys: days, strategy_summary, rationale.

days: array of exactly 7 objects. Each day (1–7) must have:
- day: 1..7
- focus_title: natural Title Case (e.g. "Capacitor and Dielectric Practice")
- time_blocks: array of 2–4 blocks. Each block: label (e.g. "Core practice", "Concept rebuild", "Mixed review", "Mini mock"), minutes (integer, e.g. 25, 35, 15), task (specific instruction), deliverable (measurable outcome).
- deliverables: array of 2–4 measurable items for the day. No duplicate deliverables across different days.
- notes: one short sentence that varies day-to-day.

Requirements:
- Vary content across days. Do NOT repeat the same block labels or same minutes every day.
- At least 2 days must be "review" days that reference previous mistakes (but not as the only content).
- At least 1 day must include "mixed-topic integration".
- At least 1 time block in the plan must be "mini-mock" or "time-pressure" (timed under exam conditions).
- Reference actual subject topics. Use concrete numbers and scope.

Good task examples (use this style):
- "Derive and apply C=εA/d to 8 questions; annotate units."
- "Solve 6 projectile motion questions with different launch angles; write 2 common pitfalls."
- "Do 10 calculus derivative chain rule problems; classify errors (algebra vs rule)."

Avoid: generic "practice problems" without a number; repeating "Timed set: 15 min, Error log: 5 min" every day.

strategy_summary: short, punchy, max 3 lines.
rationale: 3–5 bullet-like lines explaining why priorities were chosen.

Input: ${JSON.stringify(inputForPrompt)}`;

  const systemStrictRetry = "Output ONLY raw JSON. No markdown, no code fences, no <think>, no extra text. Valid JSON object with top-level key \"days\" (array of 7 day objects). Each day: day, focus_title, time_blocks (array of { label, minutes, task, deliverable }), deliverables (array), notes.";

  let rawText: string;
  try {
    rawText = await chatComplete({
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userPrompt },
      ],
      maxTokens: MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: PLAN_TIMEOUT_MS,
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      /aborted|AbortError/i.test(message) ||
      (err instanceof Error && err.name === "AbortError");
    const fallback = getFallbackPlan(fallbackInput);
    const meta = { source: "fallback" as const, reason: isTimeout ? "timeout" : "error", durationMs };
    console.log("[generate-plan] durationMs", durationMs, "source", meta.source);
    return NextResponse.json(
      {
        ...fallback,
        days: toLegacyDays(fallback.days),
        strategy_summary: fallback.strategy_summary,
        rationale: fallback.rationale,
        meta,
      },
      { status: 200 }
    );
  }

  const durationMs = Date.now() - startMs;
  const content = typeof rawText === "string" ? rawText : "";

  let jsonStr = extractJsonByKey(content, "days");
  if (jsonStr === null) {
    console.error("[generate-plan] No days key. Snippet:", content.slice(0, 400));
    const fallback = getFallbackPlan(fallbackInput);
    const meta = { source: "fallback" as const, reason: "no_key", durationMs };
    console.log("[generate-plan] durationMs", durationMs, "source", meta.source);
    return NextResponse.json(
      {
        ...fallback,
        days: toLegacyDays(fallback.days),
        strategy_summary: fallback.strategy_summary,
        rationale: fallback.rationale,
        meta,
      },
      { status: 200 }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonString(jsonStr));
  } catch (err) {
    console.error("[generate-plan] JSON parse error:", err);
    const fallback = getFallbackPlan(fallbackInput);
    const meta = { source: "fallback" as const, reason: "parse", durationMs };
    console.log("[generate-plan] durationMs", durationMs, "source", meta.source);
    return NextResponse.json(
      {
        ...fallback,
        days: toLegacyDays(fallback.days),
        strategy_summary: fallback.strategy_summary,
        rationale: fallback.rationale,
        meta,
      },
      { status: 200 }
    );
  }

  let result = OutputSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[generate-plan] Validation failed, retrying with stricter prompt:", result.error.issues);
    try {
      const retryText = await chatComplete({
        messages: [
          { role: "system", content: systemStrictRetry },
          { role: "user", content: userPrompt },
        ],
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        timeoutMs: PLAN_TIMEOUT_MS,
      });
      const retryContent = typeof retryText === "string" ? retryText : "";
      const retryStr = extractJsonByKey(retryContent, "days");
      if (retryStr !== null) {
        try {
          parsed = JSON.parse(sanitizeJsonString(retryStr));
          result = OutputSchema.safeParse(parsed);
        } catch {
          // keep result as failed
        }
      }
    } catch {
      // keep result as failed
    }
  }

  if (!result.success) {
    console.error("[generate-plan] Validation failed after retry:", result.error.issues);
    const fallback = getFallbackPlan(fallbackInput);
    const meta = { source: "fallback" as const, reason: "validation", durationMs };
    console.log("[generate-plan] durationMs", durationMs, "source", meta.source);
    return NextResponse.json(
      {
        ...fallback,
        days: toLegacyDays(fallback.days),
        strategy_summary: fallback.strategy_summary,
        rationale: fallback.rationale,
        meta,
      },
      { status: 200 }
    );
  }

  const plan = result.data;
  const meta = { source: "ai" as const, durationMs };
  console.log("[generate-plan] durationMs", durationMs, "source", meta.source);

  return NextResponse.json({
    days: toLegacyDays(plan.days),
    daysFull: plan.days,
    strategy_summary: plan.strategy_summary,
    rationale: plan.rationale,
    meta,
  });
}
