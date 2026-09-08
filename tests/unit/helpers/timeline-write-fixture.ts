import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { TransactionOutcomeSchema } from "../../../src/domain/write-safety.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { AtomicWriteCommitInputSchema } from "../../../src/infra/sqlite/write-commit-contracts.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { HASH_A, HASH_B, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";

/** Populate the immutable output that real sequencer settlement always supplies. */
export function atomicWriteCheckpoint(input: unknown) {
  const commit = AtomicWriteCommitInputSchema.parse(input);
  if (commit.ledgerOutbox.payload.kind !== "ledger-entry") throw new Error("fixture requires ledger entry");
  const ledger = commit.ledgerOutbox.payload.entry;
  return RunCheckpointRecordSchema.parse({ workflowId: ledger.workflowId, itemId: ledger.itemId,
    nodeId: `write-${ledger.writeIntentId}`, attempt: ledger.attempt, claimGeneration: 1, runId: ledger.runId,
    output: { schemaHash: deriveSchemaHash(TransactionOutcomeSchema, "output"), value: commit.outcome },
    descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B,
    provenance: [], writtenAt: commit.confirmedAt });
}

/** Unit fixtures retain an actual owner; timeline history may never manufacture it. */
export function seedAtomicWriteOwner(database: AuthorityDatabase, input: unknown): void {
  const commit = AtomicWriteCommitInputSchema.parse(input);
  if (commit.ledgerOutbox.payload.kind !== "ledger-entry") throw new Error("fixture requires ledger entry");
  const ledger = commit.ledgerOutbox.payload.entry;
  if (database.authority.runs.get(ledger.runId) !== undefined) return;
  database.authority.runs.enqueue(RunRecordSchema.parse({
    envelope: { runId: ledger.runId, workflow: ledger.workflowId, itemId: ledger.itemId,
      traceId: ledger.traceId, descriptorVersion: 1, contractFingerprint: HASH_A,
      resolvedInstance: { [ledger.system]: ledger.instance }, configFingerprint: ledger.configFingerprint,
      configSnapshotId: UUID_4, shape: "single", priority: "interactive", dryRun: false,
      attempt: ledger.attempt, enqueuedAt: ledger.fencedAt },
    input: { raw: {}, parsed: { schemaHash: HASH_A, value: {}, protectedBindings: [] }, ingressSchemaHash: HASH_A },
    lifecycle: { state: "queued" }, claimGeneration: 0, version: 1,
    createdAt: ledger.fencedAt, updatedAt: ledger.fencedAt,
  }));
}
