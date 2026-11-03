import assert from "node:assert/strict";
import { it } from "vitest";
import { composeCommandRequest, verifyShellCommandEffect } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { workbookRowChoiceId, workbookWriteLogActions, workbookWriteLogStep, workbookWriteMatchesReplay } from "../../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js";
import { RunWorkbookWritesWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { deriveStableUuid } from "../../../../src/rules/identity/stable-uuid.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { NOW, UUID_1, UUID_2, UUID_3, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const receipt = { libraryId: UUID_2, operationId: UUID_3, sequence: 1, version: 2, state: "resolve-required",
  reason: "duplicate-key", candidates: [{ sheetId: "people", rowId: "row-1" }], changes: [], source: { kind: "run", runId: UUID_1 }, at: NOW };
const target = { runId: UUID_1, expectedVersion: 4, libraryId: UUID_2, operationId: UUID_3,
  receiptDigest: sha256Hex(canonicalJsonStringify(receipt)), workbookVersion: 2 };
const operation = RunWorkbookWritesWireSchema.parse({ runId: UUID_1, operations: [{ receipt,
  native: { eventId: UUID_4, order: 1, runId: UUID_1, attempt: 1, traceId: "wc-120000-0001", spanPath: "wc-120000-0001" },
  resolution: { state: "available", target, candidates: [{ sheetId: "people", rowId: "row-1", label: "People · Row 2" }],
    action: { kind: "command", key: "resolve-workbook-row", command: "resolve-workbook-row", expectedVersion: 4, workbookTarget: target,
      label: "Choose a row", intent: "primary", placement: ["review"], confirm: { title: "Apply change", body: "Check the live row.", confirmLabel: "Apply", tone: "neutral" } } } }] }).operations[0];
assert.ok(operation.resolution.state === "available" && operation.resolution.action.kind === "command");
const action = operation.resolution.action;
const context = { actorId: "local-operator", source: "run-detail", workbookWrite: operation,
  workbookAnswer: { sheetId: "people", rowId: "row-1" } } as const;

it("composes only the current served row candidate and retains exact original receipt identity for replay", () => {
  const composed = composeCommandRequest(action, { runId: UUID_1, expectedVersion: 4 }, context);
  assert.ok(composed.state === "ready");
  const request = CommandRequestSchema.parse(composed.request);
  assert.equal(request.type, "resolve-workbook-row");
  assert.equal(workbookWriteMatchesReplay(operation, request), true);
  assert.equal(workbookWriteMatchesReplay({ ...operation, receipt: { ...operation.receipt, version: 9 } }, request), false);
  assert.equal(composeCommandRequest(action, { runId: UUID_1, expectedVersion: 5 }, context).state, "refused");
  assert.equal(composeCommandRequest(action, { runId: UUID_2, expectedVersion: 4 }, context).state, "refused");
  assert.equal(composeCommandRequest(action, { runId: UUID_1, expectedVersion: 4 }, { ...context, workbookAnswer: { sheetId: "new", rowId: "row-1" } }).state, "refused");
  const choices = workbookWriteLogActions(operation);
  assert.equal(choices[0].input?.kind, "candidate");
  assert.equal(workbookRowChoiceId({ sheetId: "a:b", rowId: "c" }) === workbookRowChoiceId({ sheetId: "a", rowId: "b:c" }), false);
  assert.equal(workbookWriteLogStep(operation).id, UUID_4);
});

it("confirms readback only after both the original choice and exact command-derived receipt settle", async () => {
  const composed = composeCommandRequest(action, { runId: UUID_1, expectedVersion: 4 }, context); assert.ok(composed.state === "ready");
  const request = CommandRequestSchema.parse(composed.request);
  const reply = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: UUID_1 }] });
  const applied = { ...operation, receipt: { ...operation.receipt, operationId: deriveStableUuid("run-workbook-row-resolution", request.commandId),
    sequence: 2, state: "applied" as const, reason: undefined, version: 3 }, resolution: { state: "not-required" as const } };
  const resolved = { ...operation, resolution: { state: "resolved" as const } };
  for (const [operations, expected] of [[[operation], "mismatch"], [[resolved], "mismatch"], [[resolved, applied], "matched"],
    [[{ ...resolved, receipt: { ...resolved.receipt, version: 9 } }, applied], "mismatch"],
    [[resolved, { ...applied, receipt: { ...applied.receipt, version: 4 } }], "mismatch"]] as const) {
    const client = { runDetail: async () => ({ runId: UUID_1, rowRevision: 4, availableSections: ["workbook-writes"] }),
      runSection: async () => ({ section: "workbook-writes", payload: { runId: UUID_1, operations } }) } as unknown as DashboardClient;
    assert.equal((await verifyShellCommandEffect(client, "2026-11-01", request, reply)).state, expected);
  }
});
