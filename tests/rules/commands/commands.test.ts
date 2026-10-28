import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT } from "../../../src/models/dashboard/assistant.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
BulkRunCommandRequestSchema,
COMMAND_EFFECT_BY_ACTION,
COMMAND_FAMILY_REGISTRY,
CommandActionSchema,
CommandAuditRecordSchema,
CommandEffectClassSchema,
CommandFamilyRegistrySchema,
CommandRequestSchema,
CommandResultSchema,
RunDisplayNameSchema,
commandEffectClass,
} from "../../../src/rules/commands/commands.js";
import { COMMAND_FIXTURES,HASH_A,NOW,UUID_1,UUID_2,UUID_3 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const CURRENT_COMMAND_FIXTURES: readonly unknown[] = Object.freeze([
  { commandId: UUID_3, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
    family: "assistant-model-preference", type: "set-assistant-model-preference", target: { profileId: UUID_1, epoch: 1, expectedRevision: 0 },
    payload: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } },
  ...COMMAND_FIXTURES,
  ...["remove-worker", "retry-worker"].map(type => ({ commandId: UUID_3, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
    family: "worker-browser", type, target: { workflowId: "person-lookup", workerId: "person-lookup-worker-1", membershipRevision: 1,
      expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } })),
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

  it("accepts proof-free rechecks and refuses the removed operator-present command", () => {
    const command = COMMAND_FIXTURES.map(input => CommandRequestSchema.parse(input)).find(input => input.type === "recheck-write");
    assert.ok(command && command.family === "run" && command.type === "recheck-write");
    assert.equal(CommandRequestSchema.safeParse({ ...command, payload: { ...command.payload, transactionId: "T123456" } }).success, true);
    assert.equal(CommandRequestSchema.safeParse({ ...command, payload: { ...command.payload, proof: { schemaHash: HASH_A, value: {} } } }).success, false);
    assert.equal(CommandRequestSchema.safeParse({ ...command, type: "resolve-write-present" }).success, false);
  });

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

  it("assigns every command action one class from the closed effect set", () => {
    assert.deepEqual(
      [...CommandEffectClassSchema.options],
      ["read", "local-write", "destructive", "external-submit"],
    );
    const expected = {
      "set-assistant-model-preference": "local-write",
      "annotate-failure": "local-write",
      "set-batch-grouping": "local-write",
      "start-run": "external-submit",
      "inspect-intake": "local-write",
      "confirm-intake-mapping": "local-write",
      "correct-intake-row": "local-write",
      "exclude-intake-row": "local-write",
      "validate-intake": "local-write",
      "enqueue-intake-manifest": "external-submit",
      "plan-worker-count": "destructive",
      "spawn-worker": "external-submit",
      "stop-worker": "destructive",
      "remove-worker": "destructive",
      "retry-worker": "external-submit",
      "pause-worker": "local-write",
      "resume-worker": "external-submit",
      "refresh-browser": "local-write",
      "reopen-browser": "local-write",
      "apply-settings": "local-write",
      "apply-protected-settings": "destructive",
      "plan-storage-relocation": "local-write",
      "cancel-storage-relocation": "local-write",
      retry: "external-submit",
      restart: "external-submit",
      cancel: "destructive",
      bump: "local-write",
      rename: "local-write",
      delete: "destructive",
      "recheck-write": "external-submit",
      "resolve-write-absent": "external-submit",
      "resolve-gate": "external-submit",
      "notification-read": "local-write",
      "notification-unread": "local-write",
      "notification-snooze": "local-write",
      "notification-unsnooze": "local-write",
      "notification-read-all": "local-write",
      "notification-unread-all": "local-write",
      "notification-snooze-all": "local-write",
      "notification-unsnooze-all": "local-write",

      "apply-explorer-edit": "local-write",
    };
    assert.deepEqual(COMMAND_EFFECT_BY_ACTION, expected);
    assert.deepEqual([...CommandActionSchema.options].sort(), Object.keys(expected).sort());
    const covered = COMMAND_FAMILY_REGISTRY.flatMap((entry) => entry.actions.map((action, index) => {
      assert.equal(entry.effects[index], expected[action]);
      return action;
    }));
    assert.deepEqual([...covered].sort(), Object.keys(expected).sort());
    assert.equal(new Set(covered).size, covered.length);
    const enqueue = CURRENT_COMMAND_FIXTURES.find((fixture) => (fixture as { readonly type: string }).type === "enqueue-intake-manifest");
    const start = CURRENT_COMMAND_FIXTURES.find((fixture) => (fixture as { readonly type: string }).type === "start-run");
    assert.equal(commandEffectClass(CommandRequestSchema.parse(enqueue)), "external-submit");
    assert.equal(commandEffectClass(CommandRequestSchema.parse({ ...(enqueue as object), payload: { dryRun: true } })), "local-write");
    assert.equal(commandEffectClass(CommandRequestSchema.parse(start)), "external-submit");
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


describe("explicit notification no-change results", () => {
  const result = { state: "applied", commandId: UUID_1, affectedTargets: [], noChange: "no-matching-notifications" };
  const request = { commandId: UUID_1, requestedAt: NOW, requestedBy: "local-operator", source: "notification-bell",
    family: "notification", type: "notification-read-all", target: { actorId: "local-operator", members: [], matchingCount: 0 } };
  const audit = { auditId: UUID_2, request, result, completedAt: NOW, versionChanges: [], affectedDependencyIds: [] };
  it("admits only tagged empty results and preserves replay shape", () => {
    assert.equal(CommandResultSchema.safeParse(result).success, true);
    assert.equal(CommandResultSchema.safeParse({ ...result, state: "already-applied" }).success, true);
    const unmarked = { state: "applied", commandId: UUID_1, affectedTargets: [] };
    assert.equal(CommandResultSchema.safeParse(unmarked).success, false);
    assert.equal(CommandResultSchema.safeParse({ ...result, affectedTargets: [{ family: "notification", notificationId: UUID_3 }] }).success, false);
    for (const field of [{ restartRequired: false }, { settingsRevision: 1 }, { settingsFingerprint: HASH_A }, { revision: 1 }, { entries: [] }]) {
      assert.equal(CommandResultSchema.safeParse({ ...result, ...field }).success, false);
    }
  });
  it("binds the terminal audit to an actual zero-match collection request", () => {
    assert.equal(CommandAuditRecordSchema.safeParse(audit).success, true);
    assert.equal(CommandAuditRecordSchema.safeParse({ ...audit, versionChanges: [{ target: { family: "notification", notificationId: UUID_3 }, before: 1, after: 2 }] }).success, false);
    assert.equal(CommandAuditRecordSchema.safeParse({ ...audit, affectedDependencyIds: ["notification-inbox"] }).success, false);
    for (const target of [{ actorId: "local-operator", notificationId: UUID_3, expectedVersion: 1 },
      { actorId: "local-operator", members: [{ notificationId: UUID_3, expectedVersion: 1 }], matchingCount: 1 }]) {
      assert.equal(CommandAuditRecordSchema.safeParse({ ...audit, request: { ...request, type: "members" in target ? "notification-read-all" : "notification-read", target } }).success, false);
    }
    assert.equal(CommandAuditRecordSchema.safeParse({ ...audit, request: CURRENT_COMMAND_FIXTURES.find(value => CommandRequestSchema.parse(value).family !== "notification") }).success, false);
  });
});
