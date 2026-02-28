// app/lib/llm.ts

const MINIMAX_BASE = "https://api.minimax.io";

export async function chatComplete({
  messages,
  maxTokens = 600,
  temperature = 0.2,
  timeoutMs = 15000,
}: {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const provider = (process.env.LLM_PROVIDER ?? "minimax").toLowerCase();

  try {
    if (provider === "minimax") {
      const apiKey = process.env.MINIMAX_API_KEY;
      const model = process.env.MINIMAX_MODEL ?? "M2-her";
      if (process.env.NODE_ENV === "development") {
        console.log("[llm] provider=minimax model=" + model);
      }
      if (!apiKey) {
        throw new Error("MINIMAX_API_KEY is not set");
      }
      const res = await fetch(`${MINIMAX_BASE}/v1/text/chatcompletion_v2`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: Math.min(1, Math.max(0, temperature)),
          max_completion_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`MiniMax error: ${res.status} ${text}`);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : "";
    }

    // Fallback: Featherless / OpenAI-compatible
    const model = process.env.FEATHERLESS_MODEL;
    if (process.env.NODE_ENV === "development") {
      console.log("[llm] provider=featherless model=" + (model ?? "(default)"));
    }
    const doFetch = (withJsonMode: boolean) => {
      const body: Record<string, unknown> = {
        model: process.env.FEATHERLESS_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (withJsonMode) body.response_format = { type: "json_object" };
      return fetch(`${process.env.FEATHERLESS_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.FEATHERLESS_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    };
    let res = await doFetch(true);
    if (!res.ok) {
      const text = await res.text();
      const isJsonModeError =
        (res.status === 400 || res.status === 422) &&
        /response_format|json_object|parameter|invalid/i.test(text);
      if (isJsonModeError) {
        res = await doFetch(false);
      } else {
        throw new Error(`Featherless error: ${res.status} ${text}`);
      }
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Featherless error: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}
