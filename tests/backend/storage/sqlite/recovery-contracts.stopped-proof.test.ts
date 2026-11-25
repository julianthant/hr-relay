import assert from "node:assert/strict";
import { it } from "vitest";
import { OfflineRestoreRequestSchema } from "../../../../src/backend/storage/sqlite/index.js";

it("refuses retired persisted stopped proofs in an offline restore request", () => {
  assert.equal(OfflineRestoreRequestSchema.safeParse({ manifestPath: "/tmp/authority.manifest.json", stoppedSystemProof: {} }).success, false);
  assert.equal(OfflineRestoreRequestSchema.safeParse({ manifestPath: "/tmp/authority.manifest.json", stoppedSystemProof: { schemaVersion: 1, proofId: "11111111-1111-4111-8111-111111111111" } }).success, false);
});
