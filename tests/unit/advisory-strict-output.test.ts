/**
 * D178 exit arm ②: **strict output.** A provider answer parses through the
 * closed advice schema or it is a typed refusal — never a partial accept,
 * never a default, and never a value the surface then treats as advice.
 *
 * Two layers are proved, because each can fail on its own:
 *
 * - the ADAPTER's layer, over a fake `fetch`: prose, an empty candidate and a
 *   fenced-but-broken body are `invalid-response`, and a 429/401 are typed
 *   `unavailable` with the closed code;
 * - the SERVICE's layer, over a scripted client: an answer that is valid JSON
 *   but does not satisfy `FailureTriageAdviceSchema` — a missing key, an out-
 *   of-union confidence, an extra key, an over-long field — is
 *   `invalid-response` whose reason names the failing PATHS and never echoes
 *   the model's text back.
 *
 * No live provider is contacted; the production adapter takes its `fetch` by
 * injection precisely so this arm can exist.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema, ProviderAdmissionIdSchema } from "../../src/domain/ids.js";
import {
  ADVISORY_ANSWER_SCHEMA_HASH,
  AdvisoryAnswerEnvelopeSchema,
  buildFailureTriagePrompt,
} from "../../src/domain/trust/advisory.js";
import { createGeminiAdvisoryAdapter } from "../../src/infra/providers/gemini-advisory.js";
import { produceFailureTriageAdvisory } from "../../src/services/trust/advisory.js";
import {
  ADVISORY_NOW,
  LEAKY_NAME,
  MAXIMAL_FAILURE,
  VALID_TRIAGE_ADVICE,
  producedTriageEnvelope,
} from "./fixtures/advisory-fixtures.js";

const CLOCK = manualClock(new Date(ADVISORY_NOW));
const OPTIONS = Object.freeze({
  signal: new AbortController().signal,
  deadlineMonotonicMs: 10_000,
  admissionId: ProviderAdmissionIdSchema.parse("00000000-0000-4000-8000-00000000ffff"),
});

function requestFor(prompt: unknown) {
  return {
    capability: "ai.advisory" as const,
    payload: { schemaHash: FingerprintSchema.parse("aa".repeat(32)), value: prompt as never },
  };
}

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return () => Promise.resolve(new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status, headers },
  ));
}

function geminiText(text: string) {
  return { responseId: "resp-1", candidates: [{ content: { parts: [{ text }] } }] };
}

/** A client that answers one scripted response and records what it was sent. */
function scriptedClient(response: unknown) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      capability: "ai.advisory" as const,
      call: (payload: unknown) => {
        sent.push(payload);
        return Promise.resolve(response as never);
      },
    },
  };
}

describe("advisory strict output — the adapter's layer", () => {
  const adapter = (fetchFn: typeof fetch) => createGeminiAdvisoryAdapter({
    apiKey: "fixture-key",
    modelId: "gemini-3-flash-preview",
    clock: CLOCK,
    fetchFn,
  });
  const prompt = buildFailureTriagePrompt(MAXIMAL_FAILURE);

  it("reports prose as invalid-response describing only its SHAPE", async () => {
    const outcome = await adapter(fakeFetch(200, geminiText("I think the run failed because…")))
      .invoke(requestFor(prompt), OPTIONS);
    assert.equal(outcome.response.state, "invalid-response");
    if (outcome.response.state !== "invalid-response") return;
    assert.match(outcome.response.reason, /chars that are not JSON/u);
    assert.equal(outcome.response.reason.includes("I think"), false, "the reason echoed the body");
  });

  it("reports an empty answer as invalid-response rather than empty advice", async () => {
    const outcome = await adapter(fakeFetch(200, geminiText("   ")))
      .invoke(requestFor(prompt), OPTIONS);
    assert.equal(outcome.response.state, "invalid-response");
  });

  it("passes a well-formed answer through VERBATIM with stamped provenance", async () => {
    const outcome = await adapter(
      fakeFetch(200, geminiText(`\`\`\`json\n${JSON.stringify(VALID_TRIAGE_ADVICE)}\n\`\`\``)),
    ).invoke(requestFor(prompt), OPTIONS);
    assert.equal(outcome.response.state, "produced");
    if (outcome.response.state !== "produced") return;
    assert.equal(outcome.response.value.schemaHash, ADVISORY_ANSWER_SCHEMA_HASH);
    const envelope = AdvisoryAnswerEnvelopeSchema.parse(outcome.response.value.value);
    assert.equal(envelope.provider, "gemini");
    assert.equal(envelope.model, "gemini-3-flash-preview");
    assert.equal(envelope.surface, "failure-triage");
    assert.equal(envelope.answerSchemaFingerprint, prompt.answerSchemaFingerprint);
    assert.deepEqual(envelope.answer, VALID_TRIAGE_ADVICE);
  });

  it("maps 429 and 401 onto the closed unavailable codes, not onto advice", async () => {
    const throttled = await adapter(
      fakeFetch(429, {}, { "retry-after": "30" }),
    ).invoke(requestFor(prompt), OPTIONS);
    assert.equal(throttled.response.state, "unavailable");
    if (throttled.response.state === "unavailable") {
      assert.equal(throttled.response.reason.code, "rate-exhausted");
      assert.equal(throttled.response.reason.retryAt, "2026-08-09T09:00:30.000Z");
    }

    const refused = await adapter(fakeFetch(401, {})).invoke(requestFor(prompt), OPTIONS);
    assert.equal(refused.response.state, "unavailable");
    if (refused.response.state === "unavailable") {
      assert.equal(refused.response.reason.code, "adapter-unavailable");
      assert.equal(refused.response.reason.retryAt, undefined);
    }
  });

  it("never puts the API key anywhere a message or URL could carry it", async () => {
    let seenUrl = "";
    const capturing: typeof fetch = (input, init) => {
      seenUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.["x-goog-api-key"],
        "fixture-key",
        "the key must travel in the header",
      );
      return Promise.resolve(new Response(JSON.stringify(geminiText("{}")), { status: 200 }));
    };
    const outcome = await adapter(capturing).invoke(requestFor(prompt), OPTIONS);
    assert.equal(seenUrl.includes("fixture-key"), false);
    assert.equal(JSON.stringify(outcome).includes("fixture-key"), false);
  });
});

describe("advisory strict output — the service's layer", () => {
  const malformed = [
    ["a missing required key", { headline: "x", checks: [], confidence: "medium" }],
    ["a confidence outside the closed union", { ...VALID_TRIAGE_ADVICE, confidence: "very high" }],
    ["an extra key the strict object refuses", { ...VALID_TRIAGE_ADVICE, retryable: true }],
    ["an empty checks list", { ...VALID_TRIAGE_ADVICE, checks: [] }],
    ["a non-object answer", "the run failed"],
  ] as const;

  for (const [label, answer] of malformed) {
    it(`refuses ${label} as invalid-response`, async () => {
      const scripted = scriptedClient({
        state: "produced",
        value: { schemaHash: ADVISORY_ANSWER_SCHEMA_HASH, value: producedTriageEnvelope(answer) },
      });
      const outcome = await produceFailureTriageAdvisory(
        { clock: CLOCK, client: scripted.client },
        MAXIMAL_FAILURE,
      );
      assert.equal(outcome.outcome, "invalid-response");
      if (outcome.outcome !== "invalid-response") return;
      assert.match(outcome.reason, /does not satisfy the failure-triage advice schema at:/u);
      // The refusal names paths, never the model's words.
      assert.equal(outcome.reason.includes("the run failed"), false);
      // …and it still records the whole invocation, so the surface can say
      // WHICH model answered badly.
      assert.equal(outcome.invocation.provider, "gemini");
      assert.equal(outcome.invocation.promptTemplateVersion, 1);
    });
  }

  it("refuses an answer produced against a DIFFERENT result schema", async () => {
    const scripted = scriptedClient({
      state: "produced",
      value: {
        schemaHash: ADVISORY_ANSWER_SCHEMA_HASH,
        value: producedTriageEnvelope(VALID_TRIAGE_ADVICE, { answerSchemaFingerprint: "ba".repeat(32) }),
      },
    });
    const outcome = await produceFailureTriageAdvisory(
      { clock: CLOCK, client: scripted.client },
      MAXIMAL_FAILURE,
    );
    assert.equal(outcome.outcome, "invalid-response");
    if (outcome.outcome !== "invalid-response") return;
    assert.match(outcome.reason, /answered against result schema/u);
  });

  it("accepts exactly the conforming answer, and sends a redacted prompt to get it", async () => {
    const scripted = scriptedClient({
      state: "produced",
      value: { schemaHash: ADVISORY_ANSWER_SCHEMA_HASH, value: producedTriageEnvelope(VALID_TRIAGE_ADVICE) },
    });
    const outcome = await produceFailureTriageAdvisory(
      { clock: CLOCK, client: scripted.client },
      MAXIMAL_FAILURE,
    );
    assert.equal(outcome.outcome, "advisory-produced");
    if (outcome.outcome !== "advisory-produced") return;
    assert.deepEqual(outcome.advice, VALID_TRIAGE_ADVICE);
    assert.equal(outcome.invocation.surface, "failure-triage");
    assert.equal(outcome.invocation.startedAt, ADVISORY_NOW);
    assert.equal(outcome.invocation.endedAt, ADVISORY_NOW);
    assert.equal(JSON.stringify(scripted.sent).includes(LEAKY_NAME), false);
  });
});
