import { sha256Hex } from "../../../src/domain/sha256.js";
import { deriveIdempotencyKeyDigest } from "../../../src/domain/write-safety.js";
import {
  BINDING_PROOF_DIGEST,
  COMMITTED_OUTCOME,
  LEDGER_PAYLOAD,
  LATER,
  NOW,
  SPAN_OUTBOX_PAYLOAD,
  SUBJECT_PROOF,
  UUID_2,
  UUID_3,
  UUID_6,
} from "./phase1c-contract-fixtures.js";

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
  overrides: Readonly<{ confirmedAt?: string; system?: string }> = {},
): LedgerCommitFixture {
  const suffix = String(index).padStart(2, "0");
  const system = overrides.system ?? "ucpath";
  const confirmedAt = overrides.confirmedAt ?? LATER;
  const idempotencyKey = `106941${suffix}|termination|2026-08-01`;
  const idempotencyKeyDigest = deriveIdempotencyKeyDigest(system, idempotencyKey);
  const writeIntentId = fixtureUuid(`intent-${suffix}-${system}`);
  const writeAttemptId = fixtureUuid(`attempt-${suffix}-${system}`);
  const ledgerOutboxId = fixtureUuid(`ledger-outbox-${suffix}-${system}`);
  const spanOutboxId = fixtureUuid(`span-outbox-${suffix}-${system}`);

  const intent = Object.freeze({
    writeIntentId,
    workflowId: "separation",
    itemId: UUID_3,
    taskId: "ucpath/terminate-person",
    system,
    idempotencyKey,
    idempotencyKeyDigest,
    currentAttemptId: writeAttemptId,
    generation: 1,
    runId: UUID_2,
    runAttempt: 1,
    bindingProof: SUBJECT_PROOF,
    bindingProofDigest: BINDING_PROOF_DIGEST,
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
    runId: UUID_2,
    runAttempt: 1,
    leaseId: UUID_6,
    bindingProof: SUBJECT_PROOF,
    bindingProofDigest: BINDING_PROOF_DIGEST,
    fencedAt: NOW,
    outcome: { state: "attempting" },
    recordedAt: NOW,
  });

  const entry = Object.freeze({
    ...LEDGER_PAYLOAD,
    system,
    idempotencyKey,
    idempotencyKeyDigest,
    writeIntentId,
    confirmedAt,
  });

  const commit = Object.freeze({
    writeIntentId,
    generation: 1,
    completionProof: LEDGER_PAYLOAD.proof,
    confirmedAt,
    outcome: { ...COMMITTED_OUTCOME, confirmedAt },
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
        occurredAt: confirmedAt,
        outcome: { ...COMMITTED_OUTCOME, confirmedAt },
      },
      projection: { state: "pending" },
      createdAt: confirmedAt,
    },
  });

  return { intent, attempt, commit, outboxId: ledgerOutboxId, confirmedAt };
}
