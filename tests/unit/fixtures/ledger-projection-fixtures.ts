import { sha256Hex } from "../../../src/domain/sha256.js";
import { deriveIdempotencyKeyDigest, deriveWriteBindingProofDigest } from "../../../src/domain/write-safety.js";
import {
  COMMITTED_OUTCOME,
  LEDGER_PAYLOAD,
  LATER,
  NOW,
  SPAN_OUTBOX_PAYLOAD,
  SUBJECT_PROOF,
  UUID_2,
  UUID_3,
  UUID_6,
} from "../../fixtures/phase1c-contract-fixtures.js";

/** A deterministic, pattern-valid UUID per named fixture slot. */
export function fixtureUuid(tag: string): string {
  const digest = sha256Hex(`hrauto:ledger-fixture:${tag}`);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export interface LedgerCommitFixture {
  readonly intent: Readonly<Record<string, unknown>>;
  readonly attempt: Readonly<Record<string, unknown>>;
  readonly commit: Readonly<Record<string, unknown>>;
  readonly outboxId: string;
  readonly confirmedAt: string;
}

/**
 * One complete beat-⑦ commit: a fenced intent, its attempt, and the atomic
 * commit whose ledger outbox the projector will later sequence. `index` only
 * varies the natural key, so every fixture is a genuinely distinct filed
 * transaction rather than a re-used identity.
 */
export function ledgerCommitFixture(
  index: number,
  overrides: Readonly<{
    confirmedAt?: string;
    system?: string;
    /**
     * Bind the filed transaction to a REAL run. The archive derives a record's
     * ledger pointers by walking `writeIntents.listByRun`, so a fixture whose
     * intent names a run nobody enqueued can never be archived — which is
     * exactly the gap `docs/rebuild/findings/archive.md` recorded.
     */
    runId?: string;
    workflowId?: string;
    itemId?: string;
    traceId?: string;
    configFingerprint?: string;
    instance?: "prod" | "test";
    /**
     * The commit's completion proof, in ONE place. It is stamped into four
     * mutually-bound spots (the entry, the commit's `completionProof`, the
     * outcome, and the terminal span's copy of the outcome) and the atomic
     * commit refuses a bundle where they disagree — so it may only ever be
     * overridden here.
     */
    proof?: Readonly<{ schemaHash: string; value: unknown }>;
  }> = {},
): LedgerCommitFixture {
  const suffix = String(index).padStart(2, "0");
  const system = overrides.system ?? "ucpath";
  const confirmedAt = overrides.confirmedAt ?? LATER;
  const runId = overrides.runId ?? UUID_2;
  const workflowId = overrides.workflowId ?? "separation";
  const itemId = overrides.itemId ?? UUID_3;
  const traceId = overrides.traceId ?? "se-120000-2222";
  const proof = overrides.proof ?? LEDGER_PAYLOAD.proof;
  const outcome = { ...COMMITTED_OUTCOME, proof, confirmedAt };
  /*
   * The binding proof names the run it was observed under, and the fence
   * refuses a proof whose run, attempt, task or lease disagrees with the
   * intent — so binding a fixture to a real run has to move the proof too, and
   * its digest is re-derived rather than carried over.
   */
  const bindingProof = Object.freeze({ ...SUBJECT_PROOF, runId });
  const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
  const idempotencyKey = `106941${suffix}|termination|2026-08-01`;
  const idempotencyKeyDigest = deriveIdempotencyKeyDigest(system, idempotencyKey);
  const writeIntentId = fixtureUuid(`intent-${suffix}-${system}`);
  const writeAttemptId = fixtureUuid(`attempt-${suffix}-${system}`);
  const ledgerOutboxId = fixtureUuid(`ledger-outbox-${suffix}-${system}`);
  const spanOutboxId = fixtureUuid(`span-outbox-${suffix}-${system}`);

  const intent = Object.freeze({
    writeIntentId,
    workflowId,
    itemId,
    taskId: "ucpath/terminate-person",
    system,
    idempotencyKey,
    idempotencyKeyDigest,
    currentAttemptId: writeAttemptId,
    generation: 1,
    runId,
    runAttempt: 1,
    bindingProof,
    bindingProofDigest,
    fencedAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    status: "attempting",
  });

  const attempt = Object.freeze({
    writeAttemptId,
    writeIntentId,
    generation: 1,
    runId,
    runAttempt: 1,
    leaseId: UUID_6,
    bindingProof,
    bindingProofDigest,
    fencedAt: NOW,
    outcome: { state: "attempting" },
    recordedAt: NOW,
  });

  const entry = Object.freeze({
    ...LEDGER_PAYLOAD,
    configFingerprint: overrides.configFingerprint ?? LEDGER_PAYLOAD.configFingerprint,
    instance: overrides.instance ?? LEDGER_PAYLOAD.instance,
    system,
    idempotencyKey,
    idempotencyKeyDigest,
    writeIntentId,
    workflowId,
    itemId,
    runId,
    traceId,
    proof,
    bindingProofDigest,
    confirmedAt,
  });

  const commit = Object.freeze({
    writeIntentId,
    generation: 1,
    completionProof: proof,
    confirmedAt,
    outcome,
    ledgerOutbox: {
      outboxId: ledgerOutboxId,
      aggregate: { kind: "write-intent", writeIntentId, generation: 1 },
      payload: { kind: "ledger-entry", entry },
      projection: { state: "pending" },
      createdAt: confirmedAt,
    },
    terminalSpanOutbox: {
      outboxId: spanOutboxId,
      aggregate: { kind: "write-intent", writeIntentId, generation: 1 },
      payload: {
        ...SPAN_OUTBOX_PAYLOAD,
        writeIntentId,
        system,
        idempotencyKey,
        idempotencyKeyDigest,
        bindingProofDigest,
        runId,
        traceId,
        workflowId,
        itemId,
        occurredAt: confirmedAt,
        outcome,
      },
      projection: { state: "pending" },
      createdAt: confirmedAt,
    },
  });

  return { intent, attempt, commit, outboxId: ledgerOutboxId, confirmedAt };
}
