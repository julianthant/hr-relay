import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
BulkRunCommandRequestSchema,
COMMAND_FAMILY_REGISTRY,
CommandActionSchema,
CommandAuditRecordSchema,
CommandFamilyRegistrySchema,
CommandRequestSchema,
CommandResultSchema,
RunDisplayNameSchema,
} from "../../../src/rules/commands/commands.js";
import { COMMAND_FIXTURES,HASH_A,NOW,UUID_1,UUID_2,UUID_3 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  ...COMMAND_FIXTURES,
  { commandId: UUID_3, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard", family: "failure-resolution", type: "annotate-failure",
    target: { runId: UUID_1, failureId: UUID_2, expectedVersion: 1 }, payload: { action: "resolve", note: "Synthetic operator annotation" } },
  {
    commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestedAt: NOW,
    requestedBy: "local-operator", source: "dashboard",
    family: "workflow-batch", type: "set-batch-grouping",
    target: { batchId: UUID_2, expectedVersion: 1 }, payload: { groupInQueue: false },
  },
  {
    commandId: UUID_2,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: 1 },
    payload: {
      protectedSchemaHash: HASH_A,
      writeId: UUID_3,
      entries: { ucpathPassword: { clear: true } },
    },
  },
]);

describe("authority classification and command families", () => {

  it("parses every closed action and keeps the family registry exhaustive", () => {
    for (const fixture of CURRENT_COMMAND_FIXTURES) assert.equal(CommandRequestSchema.safeParse(fixture).success, true);
    const fixtureActions = new Set(CURRENT_COMMAND_FIXTURES.map((fixture) => (fixture as { readonly type: string }).type));
    assert.deepEqual([...fixtureActions].sort(), [...CommandActionSchema.options].sort());
    assert.deepEqual(
      [...new Set(COMMAND_FAMILY_REGISTRY.flatMap(({ actions }) => actions))].sort(),
      [...CommandActionSchema.options].sort(),
    );
    assert.equal(Object.isFrozen(COMMAND_FAMILY_REGISTRY), true);
    assert.equal(CommandFamilyRegistrySchema.safeParse(COMMAND_FAMILY_REGISTRY.slice(1)).success, false);
    assert.equal(CommandFamilyRegistrySchema.safeParse(COMMAND_FAMILY_REGISTRY.map((entry) => (
      entry.family === "run" ? { ...entry, actions: [...entry.actions, "plan-version-bump"] } : entry
    ))).success, false);
  });

  it("keeps priority bump and rename structurally distinct", () => {
    const priority = COMMAND_FIXTURES.find((fixture) => (fixture as { readonly type: string }).type === "bump");
    const rename = COMMAND_FIXTURES.find((fixture) => (fixture as { readonly type: string }).type === "rename");
    assert.notEqual(priority, undefined);
    assert.notEqual(rename, undefined);
    assert.equal(CommandRequestSchema.safeParse({ ...priority as object, family: "version-archive" }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...priority as object, payload: { targetVersion: "2.0.0" } }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...rename as object, payload: { displayName: " Run name" } }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...rename as object, payload: { displayName: "Run name", alias: "other" } }).success, false);
    assert.equal(RunDisplayNameSchema.safeParse("e\u0301").success, false);
    assert.equal(RunDisplayNameSchema.safeParse(`valid\u0000name`).success, false);
    assert.equal(RunDisplayNameSchema.safeParse("x".repeat(121)).success, false);
  });

  it("rejects malformed envelopes and untyped gate/notification arms", () => {
    const start = COMMAND_FIXTURES[0] as Record<string, unknown>;
    const gate = COMMAND_FIXTURES.find((fixture) => (fixture as { readonly family: string }).family === "gate") as Record<string, unknown>;
    const notification = COMMAND_FIXTURES.find((fixture) => (fixture as { readonly family: string }).family === "notification") as Record<string, unknown>;
    assert.equal(CommandRequestSchema.safeParse({ ...start, commandId: "not-a-uuid" }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...start, requestedAt: "2026-07-31" }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...gate, payload: { result: "approved" } }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...gate, payload: { result: { value: "approved" } } }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...notification, type: "notification-acknowledge" }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...notification, target: { notificationId: UUID_3, expectedVersion: 1 } }).success, false);
    assert.equal(CommandRequestSchema.safeParse({
      ...start,
      family: "capture",
      type: "start-run",
      target: { captureSessionId: UUID_3, expectedVersion: 1 },
    }).success, false, "the retired capture family cannot return under a current action");
    assert.equal(CommandRequestSchema.safeParse({
      ...start,
      family: "run",
      type: "capture-finalize",
      target: { runId: UUID_3, expectedVersion: 1 },
    }).success, false, "the retired capture action cannot return under a current family");
  });

  it("keeps results, audits, and bulk commands strict", () => {
    const result = {
      state: "applied",
      commandId: UUID_1,
      affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3, expectedVersion: 1 }],
    };
    assert.equal(CommandResultSchema.safeParse(result).success, true);
    assert.equal(CommandResultSchema.safeParse({ ...result, affectedRunIds: [UUID_2] }).success, false);
    const audit = {
      auditId: UUID_2,
      request: COMMAND_FIXTURES[0],
      result,
      completedAt: NOW,
      versionChanges: [],
      affectedDependencyIds: [],
    };
    assert.equal(CommandAuditRecordSchema.safeParse(audit).success, true);
    assert.equal(CommandResultSchema.safeParse({ state: "pending", commandId: UUID_1 }).success, true);
    assert.equal(CommandAuditRecordSchema.safeParse({ ...audit, result: { state: "pending", commandId: UUID_1 } }).success, false);
    assert.equal(CommandAuditRecordSchema.safeParse({ ...audit, requester: "anonymous" }).success, false);
    const bulk = {
      commandId: UUID_1,
      bulkCommandId: UUID_2,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type: "bump",
      targets: [{ runId: UUID_3, expectedVersion: 1 }],
      mode: "all-or-none",
    };
    assert.equal(BulkRunCommandRequestSchema.safeParse(bulk).success, true);
    assert.equal(BulkRunCommandRequestSchema.safeParse({ ...bulk, type: "plan-version-bump", targetVersion: HASH_A }).success, false);
  });
});
