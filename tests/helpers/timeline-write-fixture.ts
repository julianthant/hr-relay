import { z } from "zod";
import { AtomicOutboxRecordSchema } from "../../src/domain/outbox.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { TransactionOutcomeSchema } from "../../src/domain/write-safety.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { AtomicWriteCommitInputSchema } from "../../src/infra/sqlite/write-commit-contracts.js";
import type { AuthorityDatabase } from "./synthetic-storage-admission.js";
import { HASH_A, HASH_B, UUID_4 } from "../fixtures/phase1c-contract-fixtures.js";

/** Populate the immutable output that real sequencer settlement always supplies. */
export function atomicWriteCheckpoint(input: unknown) {
  const commit = currentAtomicWriteFixture(input);
  const ledger = commit.transaction;
  return RunCheckpointRecordSchema.parse({ workflowId: ledger.workflowId, itemId: ledger.itemId,
    nodeId: `write-${ledger.writeIntentId}`, attempt: ledger.attempt, claimGeneration: 1, runId: ledger.runId,
    output: { schemaHash: deriveSchemaHash(TransactionOutcomeSchema, "output"), value: commit.outcome },
    descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B,
    provenance: [], writtenAt: commit.confirmedAt });
}

/** Unit fixtures retain an actual owner; timeline history may never manufacture it. */
export function seedAtomicWriteOwner(database: AuthorityDatabase, input: unknown): void {
  const commit = currentAtomicWriteFixture(input);
  const ledger = commit.transaction;
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

/** Explicit test-only adapter for released outbox fixture bytes. */
export function currentAtomicWriteFixture(input: unknown) {
  if (z.object({ transaction: z.unknown() }).safeParse(input).success && typeof input === "object" && input !== null && "transaction" in input) return AtomicWriteCommitInputSchema.parse(input);
  const historical = z.object({ writeIntentId: z.unknown(), generation: z.unknown(), completionProof: z.unknown(), confirmedAt: z.unknown(), outcome: z.unknown(), ledgerOutbox: AtomicOutboxRecordSchema, terminalSpanOutbox: AtomicOutboxRecordSchema }).parse(input);
  if (historical.ledgerOutbox.payload.kind !== "ledger-entry" || historical.terminalSpanOutbox.payload.kind !== "write-committed-span") throw new Error("historical fixture outbox arms required");
  const ledger = historical.ledgerOutbox.payload.entry;
  return AtomicWriteCommitInputSchema.parse({ writeIntentId: historical.writeIntentId, generation: historical.generation,
    completionProof: historical.completionProof, confirmedAt: historical.confirmedAt, outcome: historical.outcome,
    transaction: ledger, committedSpan: historical.terminalSpanOutbox.payload });
}
