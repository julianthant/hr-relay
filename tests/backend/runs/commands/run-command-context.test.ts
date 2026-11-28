import assert from "node:assert/strict";
import { it } from "vitest";
import { CommandRefusal } from "../../../../src/backend/runs/commands/command-refusal.js";
import { lifecycleRefusal } from "../../../../src/backend/runs/commands/run-command-context.js";
import { RunRecordRefusalSchema } from "../../../../src/models/config/authority.js";
import { RunCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { HASH_A, NOW, UUID_1, UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const request = RunCommandRequestSchema.parse({
  commandId: UUID_1, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
  family: "run", type: "delete", target: { runId: UUID_2, expectedVersion: 1 },
});

it.each([
  { refusal: { reason: "schema-mismatch", digest: HASH_A }, code: "schema-mismatch", message: "run schema changed" },
  { refusal: { reason: "source-deleted" }, code: "target-deleted", message: "run was deleted" },
  { refusal: { reason: "shared-checkpoint" }, code: "policy-refused", message: "This run owns a checkpoint still referenced by retained evidence." },
  { refusal: { reason: "unresolved-write" }, code: "policy-refused", message: "This run has an unresolved external write." },
  { refusal: { reason: "workflow-unregistered" }, code: "target-not-found", message: "workflow is not registered" },
  { refusal: { reason: "illegal-transition", from: "terminal", to: "running", message: "A terminal run cannot return to running." },
    code: "invalid-state", message: "A terminal run cannot return to running." },
])("preserves the operator-facing refusal for $refusal.reason", ({ refusal, code, message }) => {
  const outcome = RunRecordRefusalSchema.parse(refusal);
  assert.throws(() => lifecycleRefusal(request, outcome), (error: unknown) => {
    assert.ok(error instanceof CommandRefusal);
    assert.deepEqual(error.result, { state: "rejected", commandId: UUID_1, code, message });
    return true;
  });
});
