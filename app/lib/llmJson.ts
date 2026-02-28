import { generateText } from "ai";
import { z } from "zod";

type LanguageModel = Parameters<typeof generateText>[0]["model"];

/** Thrown when the LLM call is aborted (e.g. timeout). Do not retry; return 408 to the client. */
export class LlmTimeoutError extends Error {
  constructor() {
    super("Model timed out.");
    this.name = "LlmTimeoutError";
  }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    const msg = err.message ?? "";
    return /aborted|operation was aborted/i.test(msg);
  }
  return false;
}

/** Strip ``` fences and extract first {...} block via brace-matching. */
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

export type GenerateJsonWithGuardOptions<T extends z.ZodType> = {
  model: LanguageModel;
  prompt: string;
  schema: T;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  /** When 1 (default), retry once with retryOnceWithPrompt on parse/validation failure. When 0, no retry. */
  retries?: 0 | 1;
  /** Used when retries is 1. Ignored when retries is 0. */
  retryOnceWithPrompt?: string;
  /** Optional: transform parsed JSON before zod validation (e.g. normalize keys). */
  normalize?: (raw: unknown) => unknown;
};

/**
 * Calls the LLM with timeout, extracts JSON (strip fences, first {...}),
 * parses and validates with zod. On failure, retries once with retryOnceWithPrompt.
 * Throws a short, clean error message on final failure.
 */
export async function generateJsonWithGuard<T extends z.ZodType>(
  options: GenerateJsonWithGuardOptions<T>
): Promise<z.infer<T>> {
  const {
    model,
    prompt,
    schema,
    maxTokens,
    temperature,
    timeoutMs,
    retries = 1,
    retryOnceWithPrompt,
    normalize,
  } = options;

  function tryParse(text: string): z.infer<T> | null {
    const block = extractJsonBlock(text);
    if (!block) return null;
    try {
      let raw: unknown = JSON.parse(block);
      if (normalize) raw = normalize(raw);
      return schema.parse(raw) as z.infer<T>;
    } catch {
      return null;
    }
  }

  async function run(p: string): Promise<z.infer<T> | null> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const result = await generateText({
        model,
        prompt: p,
        maxOutputTokens: maxTokens,
        temperature,
        abortSignal: ac.signal,
      });
      return tryParse(result.text);
    } catch (err) {
      if (isAbortError(err)) throw new LlmTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  let parsed: z.infer<T> | null;
  try {
    parsed = await run(prompt);
  } catch (err) {
    if (err instanceof LlmTimeoutError) throw err;
    throw err;
  }
  if (parsed != null) return parsed;

  if (retries === 1 && retryOnceWithPrompt != null) {
    try {
      parsed = await run(retryOnceWithPrompt);
    } catch (err) {
      if (err instanceof LlmTimeoutError) throw err;
      throw err;
    }
    if (parsed != null) return parsed;
  }

  throw new Error("The model did not return valid JSON. Please try again.");
}
