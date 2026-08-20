/**
 * Ref operator-trust §4.4's operator-facing advisory producer (D178).
 *
 * The whole module holds exactly two things: a clock and an admitted
 * `ProviderClient<"ai.advisory">`. That is the zero-authority edge stated as a
 * TYPE rather than promised in prose — there is no store, no transaction, no
 * command service and no run handle in reach, so an advisory cannot transition
 * a run, resolve evidence, select identity or acknowledge a warning even by
 * accident. The caller reads the `FailureRecord` from authority and hands the
 * VALUE over; the guard `ai-advisory-no-authority` pins the module graph so a
 * later edit cannot quietly widen this list.
 *
 * The order is fixed and each step is observable:
 *
 *   ① redact — declared, per leaf, before anything leaves the process;
 *   ② prompt — the closed advice schema travels with the question;
 *   ③ admit — D112's kernel budgets, races the deadline and settles durably;
 *   ④ parse — the closed schema decides, and a miss is `invalid-response`;
 *   ⑤ record — one invocation record with template version, redacted-input
 *     digest, result-schema fingerprint, provider/model and start/end.
 *
 * Every non-produced path is a TYPED absence carrying the closed provider
 * code. There is no retry loop here on purpose: rotation across pool children
 * happens on the operator's NEXT request (one invocation is one model call),
 * and an advisory that silently retried would spend a budget the operator
 * never asked it to spend.
 */
import type { ProviderClient } from "../../base/providers.js";
import type { Clock } from "../../domain/clock.js";
import { IsoInstantSchema } from "../../domain/ids.js";
import {
  ADVISORY_PROMPT_SCHEMA_HASH,
  ADVISORY_TEMPLATES,
  AdvisoryAnswerEnvelopeSchema,
  FAILURE_TRIAGE_ADVICE_SCHEMA_HASH,
  FailureTriageAdviceSchema,
  FailureTriageOutcomeSchema,
  advisoryInputDigest,
  buildAdvisoryPrompt,
  buildAdvisoryFacts,
  parseAdvisoryAnswer,
  type FailureTriageOutcome,
} from "../../domain/trust/advisory.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";

export interface FailureTriageAdvisorDeps {
  readonly clock: Clock;
  /**
   * An admitted client bound to this advisory's execution identity. The
   * caller owns the binding because only it knows which run is the subject —
   * this module never mints one.
   */
  readonly client: ProviderClient<"ai.advisory">;
}

/**
 * Ask one advisory question about one failed run, and answer with exactly one
 * of §4.4's three outcomes.
 */
export async function produceFailureTriageAdvisory(
  deps: FailureTriageAdvisorDeps,
  failureInput: unknown,
): Promise<FailureTriageOutcome> {
  const failure = FailureRecordSchema.parse(failureInput);
  const template = ADVISORY_TEMPLATES["failure-triage"];
  const facts = buildAdvisoryFacts("failure-triage", failure);
  const prompt = buildAdvisoryPrompt("failure-triage", facts);
  const startedAt = IsoInstantSchema.parse(deps.clock.now().toISOString());
  const base = {
    surface: "failure-triage" as const,
    promptTemplateVersion: template.version,
    redactedInputDigest: advisoryInputDigest(facts),
    resultSchemaFingerprint: FAILURE_TRIAGE_ADVICE_SCHEMA_HASH,
    startedAt,
  };

  const response = await deps.client.call({
    schemaHash: ADVISORY_PROMPT_SCHEMA_HASH,
    value: prompt,
  });
  const endedAt = IsoInstantSchema.parse(deps.clock.now().toISOString());

  if (response.state === "unavailable") {
    return FailureTriageOutcomeSchema.parse({
      outcome: "unavailable",
      invocation: { ...base, endedAt },
      code: response.reason.code,
      reason: response.reason.message,
      ...(response.reason.retryAt === undefined ? {} : { retryAt: response.reason.retryAt }),
    });
  }
  if (response.state === "invalid-response") {
    return FailureTriageOutcomeSchema.parse({
      outcome: "invalid-response",
      invocation: { ...base, endedAt },
      reason: response.reason,
    });
  }

  // A produced response still has to satisfy the envelope AND the closed
  // advice schema. The envelope parse is strict, so an adapter that answered
  // a different shape is a loud programmer error rather than a silent
  // half-accept; the advice parse is a REFUSAL, because a model's answer is
  // input we do not control.
  const envelope = AdvisoryAnswerEnvelopeSchema.parse(response.value.value);
  const parsed = parseAdvisoryAnswer(
    envelope,
    FailureTriageAdviceSchema,
    FAILURE_TRIAGE_ADVICE_SCHEMA_HASH,
  );
  const invocation = { ...base, endedAt, provider: envelope.provider, model: envelope.model };
  if (!parsed.ok) {
    return FailureTriageOutcomeSchema.parse({
      outcome: "invalid-response",
      invocation,
      reason: parsed.reason,
    });
  }
  return FailureTriageOutcomeSchema.parse({
    outcome: "advisory-produced",
    invocation,
    advice: parsed.advice,
  });
}
