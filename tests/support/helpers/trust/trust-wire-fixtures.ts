
import { buildRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { FailureDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import type { RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { separationsKualiFinalizationDescriptor } from "../registered-workflows.js";
import { kualiReceiptEvidence } from "../../fixtures/receipt-run-fixtures.js";

export function receiptWireFixture(): RunEvidenceReceipt {
  const evidence = kualiReceiptEvidence();
  return buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  });
}

/** A cross-verify subject mismatch — the failed run the corpora already tell. */
export function failureDetailWireFixture(input: Readonly<{
  runId: string;
  failureId: string;
  traceId: string;
  workflowId: string;
}>) {
  const summary = "cross-verify failed: the CRM record displays a different EID than UCPath selected";
  return FailureDetailWireSchema.parse({
    runId: input.runId,
    failureId: input.failureId,
    traceId: input.traceId,
    attempt: 1,
    workflowId: input.workflowId,
    nodeId: "cross-verify",
    taskId: "crm/read-onboarding-record",
    fingerprint: "e".repeat(64),
    code: "SUBJECT_MISMATCH",
    summary,
    transient: false,
    writeState: "not-attempted",
    subject: {
      state: "present",
      expected: { kind: "eid", digest: "1".repeat(64), displayRedacted: "••••4136" },
      observed: { kind: "eid", digest: "2".repeat(64), displayRedacted: "••••5001" },
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
    diagnosticBundle: {
      state: "absent",
      reason: "no diagnostic bundle was captured; automatic capture is a separate 2g slice",
    },
    occurredAt: "2026-07-31T17:00:00.000Z",
  });
}
