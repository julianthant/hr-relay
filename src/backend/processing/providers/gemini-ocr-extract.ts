/**
 * The first PRODUCTION `ocr.extract` adapter — Gemini, legacy's priority-1
 * OCR provider (D161).
 *
 * It is deliberately thin, because route 1's whole design is that the adapter
 * adds no rule of its own: the instruction it sends is the one the store task
 * built from the registry, and everything it returns goes through the SAME
 * `admitOcrExtraction` gate the CLI routes use. What the adapter owns is
 * transport and PROVENANCE:
 *
 * - it resolves the page bytes from the content-addressed store by the FULL
 *   `ArtifactRef` (the writer itself refuses a mismatched id/sha/size), and
 *   sends them inline as base64 — the shape legacy proved on this exact
 *   corpus;
 * - it stamps `formType` / `source` / `readAt` / `sourceSha256` / `sourcePage`
 *   from the request and the injected clock, because those are facts the
 *   adapter KNOWS — the generated skeleton shows `local-agent` placeholders a
 *   model would otherwise echo back. `pageKind` and `record` pass through
 *   VERBATIM: they are the model's reading, and repairing them here would make
 *   route 1 a different producer than the operator.
 *
 * The API key travels in the `x-goog-api-key` HEADER, never in the URL, so no
 * error message or evidence line can carry it by accident
 * (`no-secret-values-in-logs`). Usage cost is 0 on purpose: the keys are
 * legacy's free-tier family and `ocrExtract`'s budget pins
 * `costLimitUsdMicros: 0`, under which ANY nonzero measured cost is a breach —
 * a paid deployment must raise the config leaf first, not this constant.
 *
 * One invocation is ONE model call. Key rotation and the provider fallback
 * chain are the 2h-D pool's job, above this adapter; a remote 429 surfaces as
 * the closed retryable `rate-exhausted` reason with the provider's own
 * `Retry-After` when it names one, else the next UTC minute boundary — the
 * same fixed-window semantics D112's counters use.
 */
import type { Readable } from "node:stream";
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import { ArtifactRefSchema } from "../../../models/artifacts/artifacts.js";
import type { Clock } from "../../../rules/time/clock.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
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
import { OcrFormTypeSchema } from "../../../models/ocr/form-registry.js";
import {
  GeminiResponseBodySchema,
  geminiAnswerText,
  geminiGenerateContent,
  geminiRetryAt,
  parseGeminiModelJson,
} from "./gemini-transport.js";
import { SubmittedExtractionSchema } from "../../../models/ocr/extraction.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";

/** The exact payload `ocr/extract-form-page` sends; refused strictly here. */
const OcrExtractRequestPayloadSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  instruction: z.string().min(1),
  page: ArtifactRefSchema,
  sourcePage: z.number().int().positive(),
});

const SUBMISSION_SCHEMA_HASH = deriveSchemaHash(SubmittedExtractionSchema, "output");

export interface GeminiOcrExtractAdapterDependencies {
  /** One key of the `geminiApiKeys` family; the composition root reads secrets. */
  readonly apiKey: string;
  /** The model this adapter speaks to; one adapter, one model (the pool is 2h-D). */
  readonly modelId: string;
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "open">;
  readonly clock: Clock;
  /** Injected for tests; production uses the platform fetch. */
  readonly fetchFn?: typeof fetch;
}

async function collectBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export function createGeminiOcrExtractAdapter(
  dependencies: GeminiOcrExtractAdapterDependencies,
): ProviderAdapter<"ocr.extract"> {
  if (dependencies.apiKey.trim() === "") throw new Error("gemini ocr.extract adapter requires a non-empty API key");
  if (dependencies.modelId.trim() === "") throw new Error("gemini ocr.extract adapter requires a model id");
  const fetchFn = dependencies.fetchFn ?? fetch;

  function parseRequest(requestInput: ProviderRequestEnvelope) {
    const request = ProviderRequestEnvelopeSchema.parse(requestInput);
    if (request.capability !== "ocr.extract") {
      throw new Error(`gemini ocr.extract adapter cannot serve capability ${request.capability}`);
    }
    return OcrExtractRequestPayloadSchema.parse(request.payload.value);
  }

  return Object.freeze({
    capability: "ocr.extract" as const,
    estimate(requestInput: ProviderRequestEnvelope) {
      parseRequest(requestInput);
      // Free-tier keys; the ocrExtract budget's zero cost limit makes any
      // nonzero measured cost a breach, so the conservative maximum IS zero.
      return deepFreeze(ProviderCostEstimateSchema.parse({ maximumCostUsdMicros: 0 }));
    },
    async invoke(
      requestInput: ProviderRequestEnvelope,
      options: ProviderCallOptions,
    ): Promise<ProviderAdapterOutcome> {
      const payload = parseRequest(requestInput);
      const pageBytes = await collectBytes(await dependencies.artifacts.open(payload.page));

      const response = await geminiGenerateContent({
        apiKey: dependencies.apiKey,
        modelId: dependencies.modelId,
        parts: [
          { text: payload.instruction },
          { inline_data: { mime_type: payload.page.mediaType, data: pageBytes.toString("base64") } },
        ],
        signal: options.signal,
        fetchFn,
      });

      const capturedAt = dependencies.clock.now().toISOString();
      const evidenceBase = {
        summary: `gemini ${dependencies.modelId} ocr.extract page ${String(payload.sourcePage)}`
          + ` -> http ${String(response.status)}`,
        capturedAt,
      };
      const usage = { requestCount: 1 as const, costUsdMicros: 0 };

      if (response.status === 429) {
        return deepFreeze(ProviderAdapterOutcomeSchema.parse({
          response: {
            state: "unavailable",
            reason: ProviderUnavailableReasonSchema.parse({
              code: "rate-exhausted",
              message: `gemini ${dependencies.modelId} answered 429 for ocr.extract`,
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
              message: `gemini ${dependencies.modelId} refused ocr.extract with http ${String(response.status)};`
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
        throw new Error(`gemini ${dependencies.modelId} answered http ${String(response.status)} for ocr.extract`);
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
      if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
        return deepFreeze(ProviderAdapterOutcomeSchema.parse({
          response: { state: "invalid-response", reason: "the model answered JSON that is not an object" },
          usage,
          evidence,
        }));
      }

      // Identity and provenance are STAMPED from what the adapter knows; the
      // model's reading — classification and answers — passes through
      // verbatim, and the one gate judges it with the same problem text every
      // route gets. A key the model omitted stays omitted, so the gate can
      // name it rather than this adapter inventing a value for it.
      const reading = parsed.value as Record<string, unknown>;
      const submission: Record<string, unknown> = {
        formType: payload.formType,
        source: { kind: "provider", providerId: "gemini", modelId: dependencies.modelId },
        readAt: capturedAt,
        sourceSha256: payload.page.sha256,
        sourcePage: payload.sourcePage,
      };
      if (Object.hasOwn(reading, "pageKind")) submission.pageKind = reading.pageKind;
      if (Object.hasOwn(reading, "record")) submission.record = reading.record;

      return deepFreeze(ProviderAdapterOutcomeSchema.parse({
        response: {
          state: "produced",
          value: { schemaHash: SUBMISSION_SCHEMA_HASH, value: submission },
        },
        usage,
        evidence,
      }));
    },
  });
}
