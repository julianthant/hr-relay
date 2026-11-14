import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { SettingsInitializationAuditSchema,SettingsInitializationCommandSchema } from "../../../src/models/config/settings-initialization.js";
import {
COMMAND_EFFECTS,
COMMAND_ROW_STATES,
CommandRowStateSchema,
UNKNOWN_EFFECT_CODES,
bulkChildClass,
bulkChildEffect,
commandResultEffect,
commandRowEffect,
commandRowStateOf,
commandRowTransition,
nativeAuditEffect,
type CommandEffect,
type CommandRowCurrent,
type CommandRowEvent,
type CommandRowState,
type CommandRowStep,
} from "../../../src/rules/commands/command-lifecycle.js";
import {
BulkRunCommandOutcomeSchema,
CommandAuditRecordSchema,
CommandRejectionCodeSchema,
CommandResultSchema,
RunLifecycleCommandAuditRecordSchema,
type CommandResult,
} from "../../../src/rules/commands/commands.js";
import { COMMAND_FIXTURES,CONFIG_SNAPSHOT,HASH_A,NOW,UUID_1,UUID_2,UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const START = COMMAND_FIXTURES[0];
const applied = (state: "applied" | "already-applied") => CommandResultSchema.parse({ state, commandId: UUID_1, affectedTargets: [{ family: "run", runId: UUID_2 }] });
const RESULTS = {
  applied: applied("applied"),
  "already-applied": applied("already-applied"),
  pending: CommandResultSchema.parse({ state: "pending", commandId: UUID_1 }),
  "confirmation-required": CommandResultSchema.parse({ state: "confirmation-required", commandId: UUID_1, warningDigest: HASH_A, message: "Confirm" }),
  conflict: CommandResultSchema.parse({ state: "conflict", commandId: UUID_1, currentVersion: 2, message: "Moved on" }),
} satisfies Record<string, CommandResult>;
const rejected = (code: string) => CommandResultSchema.parse({ state: "rejected", commandId: UUID_1, code, message: "Refused" });

describe("command lifecycle vocabulary", () => {
  it("names three effects and four row states, with executing removed and uncertain kept", () => {
    assert.deepEqual([...COMMAND_EFFECTS], ["landed", "none", "unknown"]);
    assert.deepEqual([...COMMAND_ROW_STATES], ["admitted", "succeeded", "refused", "uncertain"]);
    assert.deepEqual(CommandRowStateSchema.options, ["admitted", "succeeded", "refused", "uncertain"]);
    assert.equal(CommandRowStateSchema.safeParse("executing").success, false);
    assert.deepEqual([...UNKNOWN_EFFECT_CODES], ["bulk-child-errored"]);
  });

  it("freezes its registries", () => {
    for (const registry of [COMMAND_EFFECTS, COMMAND_ROW_STATES, UNKNOWN_EFFECT_CODES]) {
      assert.equal(Object.isFrozen(registry), true);
      assert.throws(() => { (registry as unknown as string[]).push("executing"); });
    }
  });
});

describe("commandResultEffect: wire single result → effect", () => {
  const cases: [keyof typeof RESULTS, CommandEffect][] = [
    ["applied", "landed"], ["already-applied", "landed"], ["conflict", "none"], ["confirmation-required", "none"], ["pending", "unknown"],
  ];
  for (const [state, effect] of cases) it(`${state} → ${effect}`, () => assert.equal(commandResultEffect(RESULTS[state]), effect));

  it("rejected bulk-child-errored → unknown; every other rejection code → none", () => {
    for (const code of CommandRejectionCodeSchema.options) {
      assert.equal(commandResultEffect(rejected(code)), code === "bulk-child-errored" ? "unknown" : "none", code);
    }
  });
});

describe("nativeAuditEffect: every native audit → effect", () => {
  const audit = (result: CommandResult) => CommandAuditRecordSchema.parse({ auditId: UUID_4, request: START, result, completedAt: NOW, versionChanges: [], affectedDependencyIds: [] });

  it("a command audit takes its result's effect", () => {
    assert.equal(nativeAuditEffect(audit(RESULTS.applied)), "landed");
    assert.equal(nativeAuditEffect(audit(RESULTS["already-applied"])), "landed");
    assert.equal(nativeAuditEffect(audit(RESULTS.conflict)), "none");
    assert.equal(nativeAuditEffect(audit(RESULTS["confirmation-required"])), "none");
    assert.equal(nativeAuditEffect(audit(rejected("invalid-state"))), "none");
    assert.equal(nativeAuditEffect(audit(rejected("bulk-child-errored"))), "unknown");
  });

  it("every run-lifecycle result kind is a landing", () => {
    const request = { kind: "run-lifecycle", commandId: UUID_1, operation: "clear-history", requestFingerprint: HASH_A, request: { commandId: UUID_1 }, fence: { kind: "none" }, recordedAt: NOW };
    const results = [
      { kind: "application", runtimeGeneration: 1 },
      { kind: "run", runId: UUID_2, appliedVersion: 2 },
      { kind: "deletion", runIds: [UUID_2] },
      { kind: "history-deletion", runIds: [] },
      { kind: "purge", evidenceClass: "screenshots", purged: 0 },
    ];
    for (const result of results) {
      assert.equal(nativeAuditEffect(RunLifecycleCommandAuditRecordSchema.parse({ kind: "run-lifecycle", auditId: UUID_4, request, result, completedAt: NOW })), "landed", result.kind);
    }
  });

  it("settings initialization (initialized) → landed → row succeeded", () => {
    const command = SettingsInitializationCommandSchema.parse({ kind: "settings-initialization", commandId: UUID_1, revision: 1, settings: initialSettingsFileRecord(),
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, initializedAt: CONFIG_SNAPSHOT.capturedAt });
    const initialized = SettingsInitializationAuditSchema.parse({ kind: "settings-initialization", auditId: UUID_4, request: command,
      result: { state: "initialized", revision: 1, snapshotId: CONFIG_SNAPSHOT.configSnapshotId, fingerprint: CONFIG_SNAPSHOT.fingerprint }, completedAt: command.initializedAt });
    assert.equal(nativeAuditEffect(initialized), "landed");
    assert.equal(commandRowStateOf(nativeAuditEffect(initialized)), "succeeded");
  });
});

describe("bulkChildClass and bulkChildEffect", () => {
  it("maps every wire result to a bulk child class", () => {
    assert.equal(bulkChildClass(RESULTS.applied), "applied");
    assert.equal(bulkChildClass(RESULTS["already-applied"]), "applied");
    assert.equal(bulkChildClass(RESULTS.conflict), "conflict");
    assert.equal(bulkChildClass(rejected("bulk-child-errored")), "errored");
    assert.equal(bulkChildClass(RESULTS.pending), "errored");
    assert.equal(bulkChildClass(RESULTS["confirmation-required"]), "errored");
    for (const code of CommandRejectionCodeSchema.options.filter(code => code !== "bulk-child-errored")) assert.equal(bulkChildClass(rejected(code)), "refused", code);
  });

  it("maps every bulk child class to an effect", () => {
    const expected = { applied: "landed", conflict: "none", refused: "none", errored: "unknown" } as const;
    assert.deepEqual(BulkRunCommandOutcomeSchema.options.map(option => option.shape.outcome.value).sort(), Object.keys(expected).sort());
    for (const [outcome, effect] of Object.entries(expected)) assert.equal(bulkChildEffect(outcome as keyof typeof expected), effect, outcome);
  });
});

describe("row state classifiers", () => {
  it("commandRowStateOf: landed → succeeded, none → refused, unknown → uncertain", () => {
    assert.equal(commandRowStateOf("landed"), "succeeded");
    assert.equal(commandRowStateOf("none"), "refused");
    assert.equal(commandRowStateOf("unknown"), "uncertain");
  });

  it("commandRowEffect: a bulk parent has no own effect; admitted and uncertain are unknown", () => {
    const expected: Record<CommandRowState, CommandEffect> = { admitted: "unknown", succeeded: "landed", refused: "none", uncertain: "unknown" };
    for (const state of COMMAND_ROW_STATES) {
      assert.equal(commandRowEffect({ state, bulkParent: false }), expected[state], state);
      assert.equal(commandRowEffect({ state, bulkParent: true }), "see-children", state);
    }
  });
});

describe("commandRowTransition: the row table", () => {
  const absent: CommandRowCurrent = { kind: "absent" };
  const row = (state: CommandRowState, settled: boolean, bulkParent = false): CommandRowCurrent => ({ kind: "present", state, settled, bulkParent });
  const admit = (bulkParent: boolean, sameRequest: boolean): CommandRowEvent => ({ type: "admit", bulkParent, sameRequest });
  const settle = (effect: CommandEffect, sameOutcome: boolean): CommandRowEvent => ({ type: "settle", effect, sameOutcome });
  const presentRows = [row("admitted", false), row("succeeded", true), row("refused", true), row("uncertain", true), row("succeeded", false, true)];
  const step = (current: CommandRowCurrent, event: CommandRowEvent, expected: CommandRowStep) => assert.deepEqual(commandRowTransition(current, event), expected, JSON.stringify({ current, event }));

  it("absent + admit inserts admitted for a single and succeeded (accepted) for a bulk parent", () => {
    for (const sameRequest of [true, false]) {
      step(absent, admit(false, sameRequest), { write: "insert", state: "admitted" });
      step(absent, admit(true, sameRequest), { write: "insert", state: "succeeded" });
    }
  });

  it("absent + settle is refused as a request mismatch", () => {
    for (const effect of COMMAND_EFFECTS) for (const sameOutcome of [true, false]) step(absent, settle(effect, sameOutcome), { refused: "command-audit-request-mismatch" });
  });

  it("present + admit writes nothing for the same request and refuses a different one", () => {
    for (const current of presentRows) for (const bulkParent of [true, false]) {
      step(current, admit(bulkParent, true), { write: "none" });
      step(current, admit(bulkParent, false), { refused: "command-identity-conflict" });
    }
  });

  it("admitted + settle writes the effect's row state", () => {
    for (const sameOutcome of [true, false]) {
      step(row("admitted", false), settle("landed", sameOutcome), { write: "update", state: "succeeded" });
      step(row("admitted", false), settle("none", sameOutcome), { write: "update", state: "refused" });
      step(row("admitted", false), settle("unknown", sameOutcome), { write: "update", state: "uncertain" });
    }
  });

  it("a settled row accepts only the same outcome again", () => {
    for (const state of ["succeeded", "refused", "uncertain"] as const) for (const effect of COMMAND_EFFECTS) {
      step(row(state, true), settle(effect, true), { write: "none" });
      step(row(state, true), settle(effect, false), { refused: "command-audit-outcome-conflict" });
    }
  });

  it("a bulk parent is immutable", () => {
    for (const effect of COMMAND_EFFECTS) for (const sameOutcome of [true, false]) step(row("succeeded", false, true), settle(effect, sameOutcome), { refused: "commands-bulk-immutable" });
  });

  it("refuses to step a stored row that breaks (state = admitted) = (no outcome)", () => {
    for (const current of [row("admitted", true), row("succeeded", false), row("refused", false), row("uncertain", false)]) {
      assert.throws(() => commandRowTransition(current, settle("landed", true)), /command-row-invalid/u, JSON.stringify(current));
    }
  });

  it("never moves a settled row back to admitted or to another settled state", () => {
    for (const state of ["succeeded", "refused", "uncertain"] as const) for (const effect of COMMAND_EFFECTS) for (const sameOutcome of [true, false]) {
      const result = commandRowTransition(row(state, true), settle(effect, sameOutcome));
      assert.equal("write" in result && result.write !== "none", false);
    }
  });
});

// The Start reply path recorded by run-dialog-readback-02 (decisions 5262 and 5370 on that ticket).
describe("Start: reply after commit, capacity after the reply", () => {
  const startRow = (state: CommandRowState, settled: boolean): CommandRowCurrent => ({ kind: "present", state, settled, bulkParent: false });

  it("per-workflow start lane: each Start admits its own row; a replayed Start writes nothing", () => {
    assert.deepEqual(commandRowTransition({ kind: "absent" }, { type: "admit", bulkParent: false, sameRequest: false }), { write: "insert", state: "admitted" });
    assert.deepEqual(commandRowTransition(startRow("admitted", false), { type: "admit", bulkParent: false, sameRequest: true }), { write: "none" });
    assert.deepEqual(commandRowTransition(startRow("succeeded", true), { type: "admit", bulkParent: false, sameRequest: true }), { write: "none" });
  });

  it("the reply after the run commits is a landing and settles the Start row succeeded", () => {
    assert.equal(commandResultEffect(RESULTS.applied), "landed");
    assert.equal(commandResultEffect(RESULTS["already-applied"]), "landed");
    assert.deepEqual(commandRowTransition(startRow("admitted", false), { type: "settle", effect: commandResultEffect(RESULTS.applied), sameOutcome: false }),
      { write: "update", state: "succeeded" });
  });

  it("capacity after the reply cannot resettle the landed Start", () => {
    for (const effect of ["none", "unknown"] as const) {
      assert.deepEqual(commandRowTransition(startRow("succeeded", true), { type: "settle", effect, sameOutcome: false }), { refused: "command-audit-outcome-conflict" });
    }
    assert.equal(commandRowEffect({ state: "succeeded", bulkParent: false }), "landed");
  });

  it("a detached failure with no audit leaves its command admitted, read as unknown, never refused", () => {
    assert.equal(commandRowEffect({ state: "admitted", bulkParent: false }), "unknown");
    assert.notEqual(commandRowEffect({ state: "admitted", bulkParent: false }), "none");
  });
});
