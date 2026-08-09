/**
 * The transport half every Gemini adapter shares (D178).
 *
 * `gemini-ocr-extract.ts` (D161) proved this shape on a real corpus; the
 * advisory adapter needs the identical wire behaviour — the same endpoint, the
 * same header-borne key, the same 429 → `rate-exhausted` mapping with the
 * provider's own `Retry-After`, and the same tolerance for a fenced JSON
 * answer. Two private copies of that would drift the moment one of them
 * learned something, and the thing they would drift on is how a rate limit is
 * reported to the admission kernel.
 *
 * What is deliberately NOT here: anything that decides what a response MEANS.
 * Each adapter owns its own request payload, its own provenance stamping, and
 * its own produced value — this module only speaks HTTP and JSON.
 */
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Only what these adapters consume from a `generateContent` response. */
export const GeminiResponseBodySchema = z.looseObject({
  responseId: z.string().min(1).optional(),
  candidates: z.array(z.looseObject({
    content: z.looseObject({
      parts: z.array(z.looseObject({ text: z.string().optional() })).optional(),
    }).optional(),
  })).optional(),
});
export type GeminiResponseBody = z.infer<typeof GeminiResponseBodySchema>;

/** The concatenated answer text of the first candidate; `""` when there is none. */
export function geminiAnswerText(body: GeminiResponseBody): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

/**
 * A model that follows the brief answers bare JSON, but a fenced answer is a
 * transport habit worth tolerating — stripping ```json fences changes no fact.
 * Anything that still fails to parse is `invalid-response`.
 */
export function parseGeminiModelJson(text: string):
  Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; reason: string }> {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  try {
    return { ok: true, value: JSON.parse(unfenced) as unknown };
  } catch (error) {
    // The body could contain anything the model chose to say, including page
    // or record contents, so the reason reports its SHAPE only — never an
    // excerpt. `JSON.parse`'s own message QUOTES the offending input
    // (`Unexpected token 'I', "I think the"... is not valid JSON`), which is
    // why only the error's NAME travels: D178's redaction fixture caught the
    // D161 spelling of this line passing the model's prose straight through.
    return {
      ok: false,
      reason: `the model answered ${String(unfenced.length)} chars that are not JSON`
        + ` (${error instanceof Error ? error.name : "unparseable"})`,
    };
  }
}

/**
 * When the caller may try again. With no usable `Retry-After` the answer is
 * the next fixed UTC minute boundary — D112's own window semantics, not a
 * guessed backoff.
 */
export function geminiRetryAt(retryAfter: string | null, clock: Clock): string {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(clock.nowMs() + Math.ceil(seconds) * 1000).toISOString();
    }
    const httpDate = Date.parse(retryAfter);
    if (Number.isFinite(httpDate) && httpDate > clock.nowMs()) return new Date(httpDate).toISOString();
  }
  return new Date((Math.floor(clock.nowMs() / 60_000) + 1) * 60_000).toISOString();
}

/**
 * POST one `generateContent` call. The API key travels in the `x-goog-api-key`
 * HEADER, never in the URL, so no error message, evidence line or stack trace
 * can carry it by accident (`no-secret-values-in-logs`).
 */
export async function geminiGenerateContent(input: Readonly<{
  apiKey: string;
  modelId: string;
  parts: readonly unknown[];
  signal: AbortSignal;
  fetchFn: typeof fetch;
}>): Promise<Response> {
  return input.fetchFn(
    `${GEMINI_ENDPOINT}/${input.modelId}:generateContent`,
    {
      method: "POST",
      signal: input.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: input.parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );
}
