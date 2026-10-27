import { uuidOf } from "../../../../fixtures/dashboard/fixture-identity.js";
import { sectionResponse } from "../../../../fixtures/dashboard/run-detail/section-wire.js";
import type * as FixtureIdentityTypes from "../../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../../fixtures/dashboard/fixture-queue.js";
import type * as FixtureDiagnosticTypes from "../../../../fixtures/dashboard/fixture-diagnostic.js";


export function createReceiptsFailuresSetup({ at, traceOf, FIXTURE_IDS, FIXTURE_DIAGNOSTIC_BUNDLE }: {
at: typeof FixtureIdentityTypes.at;
traceOf: typeof FixtureIdentityTypes.traceOf;
FIXTURE_IDS: typeof FixtureQueueTypes.FIXTURE_IDS;
FIXTURE_DIAGNOSTIC_BUNDLE: typeof FixtureDiagnosticTypes.FIXTURE_DIAGNOSTIC_BUNDLE;
}) {
  const RECEIPT_MISSING = {
    state: "missing",
    reason: "this fixture adapter holds no authority rows to derive a receipt from",
  } as const;

  function failureDetail(runId: string, failureId: string, seed: number) {
    const summary = "cross-verify failed: subject mismatch between CRM and UCPath";
    return {
      runId,
      failureId,
      native: { eventId: uuidOf(seed * 100 + 9900), order: 50, runId, attempt: 1, traceId: traceOf(seed), nodeId: "cross-verify" },
      resolution: {
        capability: { state: "available" },
        capture: { runId, failureId, resolution: { status: "unresolved", version: 1 } },
      },
      traceId: traceOf(seed),
      attempt: 1,
      workflowId: "person-lookup",
      nodeId: "cross-verify",
      taskId: "crm/read-onboarding-record",
      fingerprint: "e".repeat(64),
      code: "SUBJECT_MISMATCH",
      summary,
      transient: false,
      writeState: "not-attempted",
      subject: {
        state: "present",
        expected: { kind: "eid", digest: "1".repeat(64), displayRedacted: "••••5001" },
        observed: { kind: "eid", digest: "2".repeat(64), displayRedacted: "••••4136" },
      },
      page: {
        screen: "crm.onboarding",
        state: "crm.onboarding.record-ready",
        urlRedacted: "https://crm.example/onboarding/[redacted]",
        titleRedacted: "Onboarding record",
      },
      action: { operation: "read", sequence: 3 },
      causeChain: [{ code: "SUBJECT_MISMATCH", summary, role: "primary", transient: false }],
      remediation: [{
        kind: "operator-action",
        message: "Confirm which EID is correct at the source before re-running; nothing was written.",
      }],
      sameFingerprintSeen: 1,
      diagnosticBundle: { state: "present", bundleId: FIXTURE_DIAGNOSTIC_BUNDLE.bundleId },
      occurredAt: at(35),
    };
  }

  const runIds = [
    FIXTURE_IDS.queuedRun,
    FIXTURE_IDS.runningRun,
    FIXTURE_IDS.doneRun,
    FIXTURE_IDS.failedRun,
    FIXTURE_IDS.openGateRun,
    FIXTURE_IDS.gateNameMismatchRun,
    FIXTURE_IDS.parkedRun,
    FIXTURE_IDS.memberRun,
    FIXTURE_IDS.groupOf13,
  ] as const;

  const FIXTURE_RECEIPT_SECTIONS = Object.freeze(Object.fromEntries(runIds.map((runId) => [
    runId,
    Object.freeze({ receipt: sectionResponse({ section: "receipt", payload: RECEIPT_MISSING }) }),
  ])));

  const FIXTURE_FAILURE_SECTIONS = Object.freeze({
    [FIXTURE_IDS.failedRun]: Object.freeze({
      failure: sectionResponse({
        section: "failure",
        payload: { state: "available", value: failureDetail(FIXTURE_IDS.failedRun, FIXTURE_IDS.failureId, 4) },
      }),
    }),
  });

  return { FIXTURE_RECEIPT_SECTIONS, FIXTURE_FAILURE_SECTIONS };
}
