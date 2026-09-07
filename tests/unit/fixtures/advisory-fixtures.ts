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
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { QUEUED_RUN, RUN_ID } from "../../fixtures/phase1f-run-fixtures.js";

export const ADVISORY_NOW = "2026-08-09T09:00:00.000Z";

/** The values a leak would surface. Neither may appear in a prepared prompt. */
export const LEAKY_NAME = "Battistessa, Johnnie";
export const LEAKY_EID = "10456789";

export const MAXIMAL_FAILURE = FailureRecordSchema.parse({
  failureId: "3f1c2d40-0000-4000-8000-000000000901",
  fingerprint: "ab".repeat(32),
  runId: RUN_ID,
  traceId: "pl-000619-4ebf",
  attempt: 2,
  workflowId: "person-lookup",
  nodeId: "cross-verify",
  taskId: "crm/read-person",
  code: "SUBJECT_MISMATCH",
  summary: `no candidate matched ${LEAKY_NAME} (EID ${LEAKY_EID}) on the CRM search page`,
  transient: false,
  writeState: "not-attempted",
  subject: {
    expected: { kind: "eid", digest: "cd".repeat(32), displayRedacted: `EID …${LEAKY_EID.slice(-4)}` },
    observed: { kind: "name", digest: "ef".repeat(32), displayRedacted: LEAKY_NAME },
    proofRef: "3f1c2d40-0000-4000-8000-0000000009a1",
  },
  page: {
    screen: "crm.person-search",
    state: "crm.person.results",
    urlRedacted: `https://crm.ucsd.edu/search?emplid=${LEAKY_EID}`,
    titleRedacted: `Search results — ${LEAKY_NAME}`,
  },
  action: { elementId: "crm.person.results-table", operation: "read", sequence: 3 },
  causeChain: [
    {
      code: "SUBJECT_MISMATCH",
      summary: `expected ${LEAKY_NAME} but the row named someone else`,
      role: "primary",
      transient: false,
    },
    { code: "STALE_SESSION", summary: "the CRM session had expired", role: "secondary", transient: true },
  ],
  diagnosticBundleId: "3f1c2d40-0000-4000-8000-0000000009b1",
  remediation: [
    { kind: "operator-action", message: `open CRM and confirm the EID for ${LEAKY_NAME}` },
    { kind: "retry-when-served", message: "retry once the session is fresh" },
  ],
  occurredAt: ADVISORY_NOW,
});

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
