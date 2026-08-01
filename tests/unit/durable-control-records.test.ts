import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfigSnapshotRecordSchema } from "../../src/domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema, defineDelegationManifest } from "../../src/domain/dependencies.js";
import { GateResultRecordSchema, gateResultRecordSchema } from "../../src/domain/gates.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { LedgerEntryPayloadSchema, LedgerEntrySchema } from "../../src/domain/ledger.js";
import { NotificationRecordSchema } from "../../src/domain/notifications.js";
import { AtomicOutboxRecordSchema } from "../../src/domain/outbox.js";
import {
  ChildFailurePolicySchema,
  ChildRetryPolicySchema,
  ChildVisibilitySchema,
  DelegationPolicySchema,
} from "../../src/domain/workflow/delegation-policy.js";
import {
  CONFIG_SNAPSHOT,
  DELEGATION_MANIFEST,
  DEPENDENCY_RECORD,
  GATE_RESULT,
  HASH_A,
  LEDGER_OUTBOX_PAYLOAD,
  LEDGER_PAYLOAD,
  NOTIFICATION,
  NOW,
  UUID_1,
} from "./fixtures/phase1c-contract-fixtures.js";
import { z } from "zod";

describe("durable control and outbox records", () => {
  it("keeps dependencies strict and delegation manifests immutable", () => {
    assert.equal(DependencyRecordSchema.safeParse(DEPENDENCY_RECORD).success, true);
    assert.equal(DependencyRecordSchema.safeParse({ ...DEPENDENCY_RECORD, childRunId: DEPENDENCY_RECORD.parentRunId }).success, false);
    const manifest = defineDelegationManifest(DELEGATION_MANIFEST);
    assert.equal(DelegationManifestSchema.safeParse(manifest).success, true);
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(Object.isFrozen(manifest.children), true);
    assert.equal(Object.isFrozen(manifest.children[0]), true);
    assert.equal(DelegationManifestSchema.safeParse({ ...DELEGATION_MANIFEST, children: [...DELEGATION_MANIFEST.children, DELEGATION_MANIFEST.children[0]] }).success, false);
  });

  it("binds generic gate values to their declared schema hash", () => {
    assert.equal(GateResultRecordSchema.safeParse(GATE_RESULT).success, true);
    const exact = gateResultRecordSchema(
      z.strictObject({ decision: z.enum(["approve", "reject"]) }),
      FingerprintSchema.parse(HASH_A),
    );
    const value = { ...GATE_RESULT, result: { schemaHash: HASH_A, value: { decision: "approve" } } };
    assert.equal(exact.safeParse(value).success, true);
    assert.equal(exact.safeParse({ ...value, result: { ...value.result, schemaHash: "b".repeat(64) } }).success, false);
    assert.equal(exact.safeParse({ ...value, result: { schemaHash: HASH_A, value: { decision: "approve", note: "untyped" } } }).success, false);
    assert.equal(GateResultRecordSchema.safeParse({ ...GATE_RESULT, result: "approved" }).success, false);
  });

  it("pins notification routing, actor scope, and snapshot strictness", () => {
    assert.equal(NotificationRecordSchema.safeParse(NOTIFICATION).success, true);
    assert.equal(NotificationRecordSchema.safeParse({ ...NOTIFICATION, channel: "inbox" }).success, false);
    assert.equal(NotificationRecordSchema.safeParse({ ...NOTIFICATION, status: "acknowledged" }).success, false);
    assert.equal(NotificationRecordSchema.safeParse({ ...NOTIFICATION, links: [{ runId: UUID_1 }] }).success, false);
    assert.equal(ConfigSnapshotRecordSchema.safeParse(CONFIG_SNAPSHOT).success, true);
    assert.equal(ConfigSnapshotRecordSchema.safeParse({ ...CONFIG_SNAPSHOT, config: { ...CONFIG_SNAPSHOT.config, credential: "secret" } }).success, false);
  });

  it("keeps ledger and atomic outbox payloads typed and dry-run impossible", () => {
    assert.equal(LedgerEntryPayloadSchema.safeParse(LEDGER_PAYLOAD).success, true);
    assert.equal(LedgerEntryPayloadSchema.safeParse({ ...LEDGER_PAYLOAD, dryRun: true }).success, false);
    assert.equal(LedgerEntryPayloadSchema.safeParse({ ...LEDGER_PAYLOAD, proof: { value: "T123" } }).success, false);
    assert.equal(LedgerEntrySchema.safeParse({ outboxId: UUID_1, seq: 0, payload: LEDGER_PAYLOAD }).success, true);
    const outbox = {
      outboxId: UUID_1,
      aggregate: { kind: "write-intent", writeIntentId: UUID_1, generation: 1 },
      payload: LEDGER_OUTBOX_PAYLOAD,
      projection: { state: "pending" },
      createdAt: NOW,
    };
    assert.equal(AtomicOutboxRecordSchema.safeParse(outbox).success, true);
    assert.equal(AtomicOutboxRecordSchema.safeParse({ ...outbox, payload: { kind: "generic", body: {} } }).success, false);
    assert.equal(AtomicOutboxRecordSchema.safeParse({ ...outbox, projection: { state: "projected" } }).success, false);
  });
});

/**
 * D102 — one delegation vocabulary, from builder through manifest, dependency
 * row, and UI. If a future change re-splits these, this fails before the two
 * halves can drift apart again the way 1c's `DependencyPolicySchema` did.
 */
describe("D102 single delegation policy vocabulary", () => {
  it("stores the builder's exact policy shape on the durable dependency row", () => {
    const policy = {
      onChildFailed: "block-parent",
      cascadeCancel: "independent",
      afterChildRetry: "manual-parent-resume",
      visibility: "hidden-unless-failed",
    };
    assert.deepEqual(DelegationPolicySchema.parse(policy), policy);
    const record = DependencyRecordSchema.parse({ ...DEPENDENCY_RECORD, policy });
    assert.deepEqual(record.policy, policy);
  });

  it("rejects the retired 1c vocabulary rather than silently accepting it", () => {
    assert.throws(() => DependencyRecordSchema.parse({
      ...DEPENDENCY_RECORD,
      policy: { failure: "collect", cancel: "cascade", retry: "retry-child", visibility: "delegated" },
    }));
    for (const retired of ["collect", "ignore"]) {
      assert.equal(ChildFailurePolicySchema.safeParse(retired).success, false, retired);
    }
    for (const retired of ["retry-child", "replace-child", "parent-only"]) {
      assert.equal(ChildRetryPolicySchema.safeParse(retired).success, false, retired);
    }
    for (const retired of ["member", "delegated"]) {
      assert.equal(ChildVisibilitySchema.safeParse(retired).success, false, retired);
    }
  });
});
