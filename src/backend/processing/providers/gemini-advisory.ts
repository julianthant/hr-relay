/**
 * The first PRODUCTION `ai.advisory` adapter — Gemini (ref operator-trust §4.4, D178).
 *
 * It is the OCR adapter's sibling in shape and in discipline: transport and
 * PROVENANCE, nothing else. The instruction, the answer schema and the facts
 * all arrive already assembled and already REDACTED from
 * `src/domain/trust/advisory.ts` — this adapter neither builds a prompt nor
 * reads a record, so there is no second place where a classification decision
 * could be made. What it stamps is what it alone knows: which provider and
 * which model answered, and which result schema the question carried.
 *
 * The model's answer passes through VERBATIM as `answer`. Repairing it here
 * would make the adapter a second interpreter of the model's words; the
 * CONSUMER parses it against the closed advice schema and a non-conforming
 * answer becomes `invalid-response` there, with the same refusal text for
 * every surface.
 *
 * Cost is 0 on purpose: these are legacy's free-tier keys and `aiAdvisory`'s
 * budget pins `costLimitUsdMicros: 0`, under which ANY nonzero measured cost
 * is a breach — a paid deployment raises the config leaf first, not this
 * constant. One invocation is ONE model call; rotation across keys and models
 * is the pool's job above this adapter.
 */
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { AiModelIdSchema, AiProviderIdSchema } from "../../../rules/identity/ids.js";
import type { AiProviderId } from "../../../rules/identity/ids.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";
import {
  ProviderCostEstimateSchema,
  ProviderUnavailableReasonSchema,
} from "../../../rules/providers/provider-admission.js";
import {
  ProviderAdapterOutcomeSchema,
  ProviderRequestEnvelopeSchema,
  type ProviderAdapterOutcome,
  type ProviderRequestEnvelope,
} from "../../../models/providers/providers.js";
import {
  ADVISORY_ANSWER_SCHEMA_HASH,
  AdvisoryPromptSchema,
} from "../../../models/trust/advisory.js";
import {
  GeminiResponseBodySchema,
  geminiAnswerText,
  geminiGenerateContent,
  geminiRetryAt,
  parseGeminiModelJson,
} from "./gemini-transport.js";

export interface GeminiAdvisoryAdapterDependencies {
  /** One key of the `geminiApiKeys` family; the composition root reads secrets. */
  readonly apiKey: string;
  /** The model this adapter speaks to; one adapter, one model (the pool rotates). */
  readonly modelId: string;
  readonly clock: Clock;
  /** Injected for tests; production uses the platform fetch. */
  readonly fetchFn?: typeof fetch;
}

const PROVIDER: AiProviderId = AiProviderIdSchema.parse("gemini");

export function createGeminiAdvisoryAdapter(
  dependencies: GeminiAdvisoryAdapterDependencies,
): ProviderAdapter<"ai.advisory"> {
  if (dependencies.apiKey.trim() === "") throw new Error("gemini ai.advisory adapter requires a non-empty API key");
  const modelId = AiModelIdSchema.parse(dependencies.modelId);
  const fetchFn = dependencies.fetchFn ?? fetch;

  function parseRequest(requestInput: ProviderRequestEnvelope) {
    const request = ProviderRequestEnvelopeSchema.parse(requestInput);
    if (request.capability !== "ai.advisory") {
      throw new Error(`gemini ai.advisory adapter cannot serve capability ${request.capability}`);
    }
    return AdvisoryPromptSchema.parse(request.payload.value);
  }

  return Object.freeze({
    capability: "ai.advisory" as const,
    estimate(requestInput: ProviderRequestEnvelope) {
      parseRequest(requestInput);
      return deepFreeze(ProviderCostEstimateSchema.parse({ maximumCostUsdMicros: 0 }));
    },
    async invoke(
      requestInput: ProviderRequestEnvelope,
      options: ProviderCallOptions,
    ): Promise<ProviderAdapterOutcome> {
      const prompt = parseRequest(requestInput);

      const response = await geminiGenerateContent({
        apiKey: dependencies.apiKey,
        modelId,
        parts: [
          { text: prompt.instruction },
          { text: `Answer with JSON matching this schema:\n${JSON.stringify(prompt.answerSchema)}` },
          { text: `Facts (redacted; a "redacted" entry was withheld by policy):\n${JSON.stringify(prompt.facts)}` },
        ],
        signal: options.signal,
        fetchFn,
      });

      const capturedAt = dependencies.clock.now().toISOString();
      const evidenceBase = {
        summary: `gemini ${modelId} ai.advisory ${prompt.surface}`
          + ` (template v${String(prompt.templateVersion)}) -> http ${String(response.status)}`,
        capturedAt,
      };
      const usage = { requestCount: 1 as const, costUsdMicros: 0 };

      if (response.status === 429) {
        return deepFreeze(ProviderAdapterOutcomeSchema.parse({
          response: {
            state: "unavailable",
            reason: ProviderUnavailableReasonSchema.parse({
              code: "rate-exhausted",
              message: `gemini ${modelId} answered 429 for ai.advisory`,
              retryAt: geminiRetryAt(response.headers.get("retry-after"), dependencies.clock),
            }),
          },
          usage,
          evidence: evidenceBase,
        }));
      }
      if (response.status === 401 || response.status === 403) {
        // A key or entitlement problem is a human's to fix; retrying cannot.
        return deepFreeze(ProviderAdapterOutcomeSchema.parse({
          response: {
            state: "unavailable",
            reason: {
              code: "adapter-unavailable",
              message: `gemini ${modelId} refused ai.advisory with http ${String(response.status)};`
                + " the configured key or its entitlement needs attention",
            },
          },
          usage,
          evidence: evidenceBase,
        }));
      }
      if (!response.ok) {
        // Transient or unknown remote failure: throw, so admission records a
        // durable interruption instead of a fabricated verdict.
        throw new Error(`gemini ${modelId} answered http ${String(response.status)} for ai.advisory`);
      }

      const body = GeminiResponseBodySchema.parse(await response.json());
      const text = geminiAnswerText(body);
      const evidence = {
        ...evidenceBase,
        summary: `${evidenceBase.summary}, ${String(text.length)} chars`,
        ...(body.responseId === undefined ? {} : { providerRequestId: body.responseId }),
      };
      if (text.trim() === "") {
        return deepFreeze(ProviderAdapterOutcomeSchema.parse({
          response: { state: "invalid-response", reason: "the model returned no answer text" },
          usage,
          evidence,
        }));
      }
      const parsed = parseGeminiModelJson(text);
      if (!parsed.ok) {
        return deepFreeze(ProviderAdapterOutcomeSchema.parse({
          response: { state: "invalid-response", reason: parsed.reason },
          usage,
          evidence,
        }));
      }

      return deepFreeze(ProviderAdapterOutcomeSchema.parse({
        response: {
          state: "produced",
          value: {
            schemaHash: ADVISORY_ANSWER_SCHEMA_HASH,
            value: {
              surface: prompt.surface,
              provider: PROVIDER,
              model: modelId,
              answerSchemaFingerprint: prompt.answerSchemaFingerprint,
              answer: parsed.value,
            },
          },
        },
        usage,
        evidence,
      }));
    },
  });
}
