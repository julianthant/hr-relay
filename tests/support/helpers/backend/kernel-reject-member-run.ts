import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";

export function kernelRejectMemberRecord<Input>(
  parent: {
    readonly envelope: {
      readonly contractFingerprint: string;
      readonly configFingerprint: string;
      readonly configSnapshotId: string;
      readonly traceId: string;
    };
    readonly input: Input;
  },
  parentRunId: string,
  runId: string,
  itemKey: string,
  traceId: string,
  edgeId: string,
  now: string,
) {
  return {
    envelope: {
      runId,
      workflow: "kernel-reject",
      itemId: deriveItemId("kernel-reject", itemKey),
      traceId,
      descriptorVersion: 1,
      contractFingerprint: parent.envelope.contractFingerprint,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: parent.envelope.configFingerprint,
      configSnapshotId: parent.envelope.configSnapshotId,
      parent: { runId: parentRunId, tracePrefix: parent.envelope.traceId, edgeId },
      shape: "operation-member",
      priority: "bulk",
      dryRun: false,
      attempt: 1,
      enqueuedAt: now,
    },
    input: parent.input,
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
