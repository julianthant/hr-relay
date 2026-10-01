/**
 * Shared fixtures for the four D178 advisory arms (doc 02 §Exit
 * criterion: "AI-advisory fixtures prove redaction, strict output, provider
 * exhaustion, zero authority edge").
 *
 * `MAXIMAL_FAILURE` carries EVERY optional branch a `FailureRecord` can hold,
 * and its free-text fields deliberately name a person and an employee id: the
 * redaction arm is only meaningful if the record it redacts would leak
 * something when redaction is skipped.
 *
 * No test in this family reaches a live provider. The transport is the
 * deterministic harness, and the ONE production adapter that speaks HTTP takes
 * its `fetch` by injection for exactly this reason.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock } from "../../../src/domain/clock.js";
import { defaultRuntimePaths } from "../../../src/domain/config/runtime-paths.js";
import { ConfigSchema } from "../../../src/domain/config/schema.js";
import {
  IsoInstantSchema,
  ProviderAdmissionIdSchema,
} from "../../../src/domain/ids.js";
import {
  ADVISORY_ANSWER_SCHEMA_HASH,
  FAILURE_TRIAGE_ADVICE_SCHEMA_HASH,
} from "../../../src/domain/trust/advisory.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { QUEUED_RUN } from "../../fixtures/phase1f-run-fixtures.js";

import { ADVISORY_NOW } from "../../fixtures/advisory-prompt-fixtures.js";
export { ADVISORY_NOW, LEAKY_NAME, LEAKY_EID, MAXIMAL_FAILURE } from "../../fixtures/advisory-prompt-fixtures.js";

/** A well-formed advisory answer envelope for the failure-triage surface. */
export function producedTriageEnvelope(answer: unknown, overrides: Readonly<{
  answerSchemaFingerprint?: string;
}> = {}) {
  return {
    surface: "failure-triage",
    provider: "gemini",
    model: "gemini-3-flash-preview",
    answerSchemaFingerprint: overrides.answerSchemaFingerprint ?? FAILURE_TRIAGE_ADVICE_SCHEMA_HASH,
    answer,
  };
}

export const VALID_TRIAGE_ADVICE = {
  headline: "The CRM row did not name the expected person",
  explanation: "A subject mismatch means the page loaded but the identity check refused the row it found.",
  checks: [{ what: "the CRM search input", why: "a stale query returns the previous person's row" }],
  confidence: "medium",
} as const;

export function producedOutcome(value: unknown) {
  return {
    response: { state: "produced", value: { schemaHash: ADVISORY_ANSWER_SCHEMA_HASH, value } },
    usage: { requestCount: 1, costUsdMicros: 0 },
    evidence: { summary: "advisory fixture", capturedAt: ADVISORY_NOW },
  };
}

export interface AdvisoryAuthorityHarness {
  readonly database: AuthorityDatabase;
  readonly clock: ReturnType<typeof manualClock>;
  readonly dispose: () => void;
}

/**
 * A real authority database holding the D178 subject: one CLAIMED-then-failed
 * person-lookup run and the config snapshot it retained. The advisory binds
 * that run's own identity, so the harness has to be real — a fake repository
 * would prove nothing about the reserve-time validation this slice changed.
 */
export function openAdvisoryAuthority(options: Readonly<{
  aiAdvisoryBudget?: Readonly<{
    timeoutMs: number;
    concurrency: number;
    requestsPerMinute: number;
    dailyRequestLimit: number;
    costLimitUsdMicros: number;
  }>;
}> = {}): AdvisoryAuthorityHarness {
  const clock = manualClock(new Date(ADVISORY_NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-advisory-"));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  const defaults = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  const config = ConfigSchema.parse({
    ...defaults,
    providers: {
      ...defaults.providers,
      aiAdvisory: options.aiAdvisoryBudget ?? {
        timeoutMs: 30_000,
        concurrency: 2,
        requestsPerMinute: 10,
        dailyRequestLimit: 100,
        costLimitUsdMicros: 0,
      },
    },
  });
  database.authority.configSnapshots.insert({
    configSnapshotId: QUEUED_RUN.envelope.configSnapshotId,
    revision: 1,
    fingerprint: QUEUED_RUN.envelope.configFingerprint,
    capturedAt: IsoInstantSchema.parse(ADVISORY_NOW),
    capturedBy: "local-operator",
    config,
    provenance: {},
  });
  database.authority.runs.enqueue(QUEUED_RUN);
  return {
    database,
    clock,
    dispose: (): void => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function advisoryAdmissionIdFactory() {
  let next = 0;
  return Object.freeze({
    next: () => {
      next += 1;
      return ProviderAdmissionIdSchema.parse(`00000000-0000-4000-8000-${String(next).padStart(12, "0")}`);
    },
  });
}

/** The kernel's deadline seam, driven by hand so no arm waits on a timer. */
export function immediateScheduler() {
  return Object.freeze({
    schedule: () => Object.freeze({ cancel: () => undefined }),
  });
}
