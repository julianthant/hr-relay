// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, it } from "vitest";
import type { CommandAttemptView } from "../../../../src/dashboard/app/commands/command-outcome.js";
import type { CommandOutcome } from "../../../../src/dashboard/app/commands/command-executor.js";
import {
  initialRunDialogState, REFERENCES_UNAVAILABLE, runDialogControls, runDialogTransition, useRunDialogMachine, visibleRunDialog,
  type LaunchGates, type RunDialogEffects, type RunDialogEvent, type RunDialogState, type RunDialogStep, type RunStartStage,
} from "../../../../src/dashboard/surfaces/run-start/run-dialog-model.js";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanWire } from "../../../../src/models/dashboard/start-plan.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { CommandResultSchema, StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const FP = "fingerprint-now";
const OLD = "fingerprint-before";
const HASH = "a".repeat(64);
const DIGEST = "b".repeat(64);
const ACTOR = "local-operator";
const WORKFLOW = "person-lookup";
const RERUN = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
const FINGERPRINTS = { descriptorFingerprint: HASH, configFingerprint: HASH, ingressSchemaHash: HASH, canonicalInputSchemaHash: HASH, inputFingerprint: HASH };
const PLAN_A = "5a000000-0000-4000-8000-000000000001";
const PLAN_B = "5a000000-0000-4000-8000-000000000002";

function plan(startPlanId: string, extra: Record<string, unknown> = {}): StartPlanWire {
  return StartPlanWireSchema.parse({ wireVersion: 1, startPlanId, workflowId: WORKFLOW, expectedVersion: 4, expiresAt: "2026-08-26T21:47:03.000Z",
    dryRun: false, priority: "interactive", plannedBy: ACTOR, configSnapshotId: "c0000000-0000-4000-8000-000000000001", fingerprints: FINGERPRINTS,
    planned: [{ logicalKey: "entry:1", title: "Ada Lovelace", matchKey: "eid:E1234567" }], refused: [], ...extra });
}
const REQUEST = StartPlanRequestSchema.parse({ workflowId: WORKFLOW, submissions: [{ eid: "10812345" }], dryRun: false, browserMode: "headless", captureBrowserScreenshots: false });
const EXPIRY_REQUEST = StartPlanRequestSchema.parse({ ...REQUEST, submissions: [{ eid: "10812346" }] });
function command(startPlanId: string, commandId = "c1000000-0000-4000-8000-000000000001") {
  return StartCommandRequestSchema.parse({ commandId, requestedAt: "2026-08-26T21:40:00.000Z", requestedBy: ACTOR, source: "run-start",
    family: "start", type: "start-run", target: { workflowId: WORKFLOW, startPlanId, expectedVersion: 4 }, payload: FINGERPRINTS });
}
const SNAPSHOT = RerunValuesSnapshotSchema.parse({ source: { runId: RERUN.runId, version: RERUN.expectedVersion, workflow: WORKFLOW,
  descriptorVersion: 1, contractFingerprint: HASH, outcome: "done" }, sourceInput: { state: "unavailable", reason: "protected" }, steps: [], values: [], transactions: [] });
const RERUN_PLAN_SOURCE = { runId: RERUN.runId, expectedVersion: RERUN.expectedVersion, intent: "rerun", selectedStepKeys: ["save"] };
const REPEAT = { nodeId: "save-row", taskId: "ucpath/save-row", system: "ucpath", businessKeyDigest: HASH, writeIntentId: "d1000000-0000-4000-8000-000000000001", evidenceDigest: HASH };
const WARNING = RerunWarningWireSchema.parse({ workflowId: WORKFLOW, rerun: { source: RERUN_PLAN_SOURCE, warnings: [REPEAT], warningDigest: DIGEST } });
const NO_WARNING = RerunWarningWireSchema.parse({ workflowId: WORKFLOW, rerun: { source: RERUN_PLAN_SOURCE, warnings: [], warningDigest: DIGEST } });
const PARSED_ANSWER = CommandResultSchema.parse({ state: "confirmation-required", commandId: "c1000000-0000-4000-8000-000000000001", warningDigest: HASH, message: "Confirm the repeat." });
if (PARSED_ANSWER.state !== "confirmation-required") throw new Error("the answer fixture must ask for confirmation");
const ANSWER = PARSED_ANSWER;
const applied = (commandId: string) => CommandResultSchema.parse({ state: "applied", commandId,
  affectedTargets: [{ family: "start", workflowId: WORKFLOW, startPlanId: PLAN_A, expectedVersion: 4 }] });
const feedback = formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {}));
const authorityText = formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text;

const LAST: LaunchGates = { next: null, inputBlocked: false, stepsBlocked: false, rerunInputBlocked: false, referencesUnavailable: false, omissionMismatch: false, plannedCount: 1 };
const gates = (patch: Partial<LaunchGates> = {}): LaunchGates => ({ ...LAST, ...patch });
const at = (patch: Partial<RunDialogState>): RunDialogState => ({ ...initialRunDialogState, ...patch });
const rerunReady = (load: Partial<{ warning: typeof WARNING; acknowledgment: string }> = {}) =>
  ({ kind: "rerun", request: RERUN, load: { state: "ready", snapshot: SNAPSHOT, ...load } }) as const;
const shownA = { for: FP, plan: plan(PLAN_A), request: REQUEST, expired: false };
const startEvent = (patch: Partial<LaunchGates> = {}, authority: "ok" | "replaced" = "ok", prepared: string[] = []): RunDialogEvent => ({
  type: "start", gates: gates(patch), authority: { state: authority }, planRequest: () => REQUEST,
  prepare: p => { prepared.push(p.startPlanId); return command(p.startPlanId, "c2000000-0000-4000-8000-000000000002"); },
});
const submitting = (extra: Partial<{ expiryRequest: typeof REQUEST; plannedCount: number; for: string; request: number }> = {}) =>
  ({ kind: "submitting", request: 7, for: FP, command: command(PLAN_A), ...extra }) as const;

function moved(state: RunDialogState, event: RunDialogEvent, fingerprint = FP): Extract<RunDialogStep, { next: unknown }> {
  const result = runDialogTransition(state, event, fingerprint);
  if ("refused" in result) assert.fail(`refused ${result.refused} for ${event.type}`);
  return result;
}
const refusal = (state: RunDialogState, event: RunDialogEvent, fingerprint = FP) => {
  const result = runDialogTransition(state, event, fingerprint);
  return "refused" in result ? result.refused : undefined;
};
const kinds = (result: Extract<RunDialogStep, { next: unknown }>) => result.effects.map(effect => effect.kind);
const settled = (view: CommandAttemptView, reply?: typeof ANSWER): RunDialogEvent => ({ type: "submit-settled", request: 7, view, ...(reply === undefined ? {} : { reply }) });

describe("run dialog stages", () => {
  it("has no Confirm stage", () => {
    // @ts-expect-error Confirm is not a Run dialog stage
    const confirm: RunStartStage = "Confirm";
    assert.equal(confirm, "Confirm");
  });
});

describe("open, close, source and draft", () => {
  it("open (start) lands on Input, idle, with the recovery read", () => {
    const recovery = { state: "retained", command: command(PLAN_A) } as const;
    const result = moved(at({ stage: "Options", activity: { kind: "planning", request: 3, for: FP }, detached: [{ kind: "planning", request: 2, for: OLD }] }),
      { type: "open", recovery, landOnValues: false });
    assert.equal(result.next.stage, "Input");
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.deepEqual(result.next.detached, []);
    assert.equal(result.next.recovery, recovery);
    assert.deepEqual(result.effects, []);
  });

  it("open (rerun) lands on Steps, or Values, and loads the source", () => {
    const steps = moved(at({ nextRequest: 5 }), { type: "open", recovery: { state: "none" }, rerun: RERUN, landOnValues: false });
    assert.equal(steps.next.stage, "Steps");
    assert.deepEqual(steps.next.source, { kind: "rerun", request: RERUN, load: { state: "loading", request: 5 } });
    assert.deepEqual(steps.effects, [{ kind: "load-source", request: 5 }]);
    assert.equal(moved(at({}), { type: "open", recovery: { state: "none" }, rerun: RERUN, landOnValues: true }).next.stage, "Values");
  });

  it("source-loaded with the requested identity makes the source ready; another number is superseded", () => {
    const loading = at({ stage: "Steps", source: { kind: "rerun", request: RERUN, load: { state: "loading", request: 4 } } });
    assert.deepEqual(moved(loading, { type: "source-loaded", request: 4, snapshot: SNAPSHOT }).next.source, rerunReady());
    assert.equal(refusal(loading, { type: "source-loaded", request: 3, snapshot: SNAPSHOT }), "superseded");
    assert.equal(refusal(loading, { type: "source-failed", request: 3, message: "x" }), "superseded");
  });

  it("a snapshot for another run or version, and source-failed, fail the source", () => {
    const loading = at({ stage: "Steps", source: { kind: "rerun", request: RERUN, load: { state: "loading", request: 4 } } });
    const other = RerunValuesSnapshotSchema.parse({ ...SNAPSHOT, source: { ...SNAPSHOT.source, version: 9 } });
    const failed = moved(loading, { type: "source-loaded", request: 4, snapshot: other }).next.source;
    assert.ok(failed.kind === "rerun" && failed.load.state === "failed");
    assert.equal(failed.load.message, formatErrorCatalogFailure(createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" })).text);
    assert.deepEqual(moved(loading, { type: "source-failed", request: 4, message: "Rerun unavailable: gone" }).next.source,
      { kind: "rerun", request: RERUN, load: { state: "failed", message: "Rerun unavailable: gone" } });
  });

  it("pick-workflow returns to Input and clears the plan, problem and answer but keeps prepared; refused while a submit exists", () => {
    const prepared = command(PLAN_A);
    const state = at({ stage: "Options", shown: shownA, problem: "p", prepared, activity: { kind: "planning", request: 2, for: FP },
      recovery: { state: "retained", command: prepared, answer: { reply: ANSWER, for: FP } } });
    const result = moved(state, { type: "pick-workflow" });
    assert.equal(result.next.stage, "Input");
    assert.equal(result.next.shown, undefined);
    assert.equal(result.next.problem, undefined);
    assert.equal(result.next.prepared, prepared);
    assert.deepEqual(result.next.recovery, { state: "retained", command: prepared });
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.equal(refusal(at({ activity: submitting() }), { type: "pick-workflow" }), "busy");
    assert.equal(refusal(at({ detached: [{ kind: "replanning", request: 3, for: FP, planRequest: REQUEST }] }), { type: "pick-workflow" }), "busy");
  });

  it("draft-changed clears the plan, problem and answer; the stage and requests stay", () => {
    const prepared = command(PLAN_A);
    const activity = { kind: "planning", request: 2, for: OLD } as const;
    const result = moved(at({ stage: "Options", shown: shownA, problem: "p", activity, recovery: { state: "retained", command: prepared, answer: { reply: ANSWER, for: OLD } } }),
      { type: "draft-changed" });
    assert.equal(result.next.stage, "Options");
    assert.equal(result.next.shown, undefined);
    assert.equal(result.next.problem, undefined);
    assert.deepEqual(result.next.recovery, { state: "retained", command: prepared });
    assert.equal(result.next.activity, activity);
  });

  it("close drops an answered submission; otherwise it keeps the saved submission and prepared", () => {
    const prepared = command(PLAN_A);
    const answered = moved(at({ stage: "Options", shown: shownA, problem: "p", prepared, activity: submitting(),
      recovery: { state: "retained", command: prepared, answer: { reply: ANSWER, for: FP } } }), { type: "close" });
    assert.equal(answered.next.stage, "Input");
    assert.deepEqual(answered.next.recovery, { state: "none" });
    assert.equal(answered.next.prepared, undefined);
    assert.equal(answered.next.shown, undefined);
    assert.deepEqual(answered.next.activity, { kind: "idle" });
    assert.deepEqual(answered.effects, [{ kind: "dismiss-recovery", command: prepared }]);
    const plain = moved(at({ stage: "Options", shown: shownA, prepared, recovery: { state: "retained", command: prepared } }), { type: "close" });
    assert.deepEqual(plain.next.recovery, { state: "retained", command: prepared });
    assert.equal(plain.next.prepared, prepared);
    assert.deepEqual(plain.effects, []);
  });
});

describe("moving between stages", () => {
  it("back goes to the previous stage, even while busy; not on Warning or the first stage", () => {
    assert.equal(moved(at({ stage: "Steps", activity: { kind: "planning", request: 1, for: FP } }), { type: "go-to", stage: "Options", via: "back" }).next.stage, "Options");
    assert.equal(moved(at({ stage: "Options", source: rerunReady() }), { type: "go-to", stage: "Values", via: "back" }).next.stage, "Values");
    assert.equal(moved(at({ stage: "Values", source: rerunReady() }), { type: "go-to", stage: "Steps", via: "back" }).next.stage, "Steps");
    assert.equal(refusal(at({ stage: "Warning", source: rerunReady({ warning: WARNING }) }), { type: "go-to", stage: "Steps", via: "back" }), "not-here");
    assert.equal(refusal(at({ stage: "Input" }), { type: "go-to", stage: "Input", via: "back" }), "not-here");
    assert.equal(refusal(at({ stage: "Steps", source: rerunReady() }), { type: "go-to", stage: "Steps", via: "back" }), "not-here");
  });

  it("the stage bar goes to an earlier stage only, idle and without a saved submission", () => {
    assert.equal(moved(at({ stage: "Steps" }), { type: "go-to", stage: "Input", via: "stage-bar" }).next.stage, "Input");
    assert.equal(refusal(at({ stage: "Input" }), { type: "go-to", stage: "Options", via: "stage-bar" }), "not-here");
    assert.equal(refusal(at({ stage: "Steps", recovery: { state: "retained", command: command(PLAN_A) } }), { type: "go-to", stage: "Input", via: "stage-bar" }), "blocked");
    assert.equal(refusal(at({ stage: "Steps", activity: { kind: "planning", request: 1, for: FP } }), { type: "go-to", stage: "Input", via: "stage-bar" }), "busy");
  });

  it("continue is busy while a request runs", () => {
    assert.equal(refusal(at({ activity: { kind: "planning", request: 1, for: FP } }), { type: "continue", gates: gates({ next: "Options" }) }), "busy");
  });

  it("continue is blocked by a saved or unreadable submission, and for a rerun until the source is ready", () => {
    assert.equal(refusal(at({ recovery: { state: "unreadable", message: "bad" } }), { type: "continue", gates: gates({ next: "Options" }) }), "blocked");
    assert.equal(refusal(at({ recovery: { state: "retained", command: command(PLAN_A) } }), { type: "continue", gates: gates({ next: "Options" }) }), "blocked");
    assert.equal(refusal(at({ stage: "Steps", source: { kind: "rerun", request: RERUN, load: { state: "loading", request: 1 } } }), { type: "continue", gates: gates({ next: "Values" }) }), "blocked");
  });

  it("Input continues to Options unless the input is blocked", () => {
    assert.equal(moved(at({ stage: "Input" }), { type: "continue", gates: gates({ next: "Options" }) }).next.stage, "Options");
    assert.equal(refusal(at({ stage: "Input" }), { type: "continue", gates: gates({ next: "Options", inputBlocked: true }) }), "blocked");
  });

  it("Options continues to Steps when Customize steps is on", () => {
    const result = moved(at({ stage: "Options" }), { type: "continue", gates: gates({ next: "Steps" }) });
    assert.equal(result.next.stage, "Steps");
    assert.deepEqual(result.effects, []);
  });

  it("rerun Values continues to Options unless its input or step facts are blocked", () => {
    assert.equal(moved(at({ stage: "Values", source: rerunReady() }), { type: "continue", gates: gates({ next: "Options" }) }).next.stage, "Options");
    assert.equal(refusal(at({ stage: "Values", source: rerunReady() }), { type: "continue", gates: gates({ next: "Options", rerunInputBlocked: true }) }), "blocked");
    assert.equal(refusal(at({ stage: "Values", source: rerunReady() }), { type: "continue", gates: gates({ next: "Options", stepsBlocked: true }) }), "blocked");
  });

  it("continue on the last stage or Warning is not a move", () => {
    assert.equal(refusal(at({ stage: "Options" }), { type: "continue", gates: LAST }), "not-here");
    assert.equal(refusal(at({ stage: "Warning", source: rerunReady({ warning: WARNING }) }), { type: "continue", gates: gates({ next: "Values" }) }), "not-here");
  });

  it("start's common admission: busy, unreadable, a saved submission for another plan, and only on the last stage", () => {
    const prepared: string[] = [];
    assert.equal(refusal(at({ stage: "Options", activity: { kind: "planning", request: 1, for: FP } }), startEvent({}, "ok", prepared)), "busy");
    assert.equal(refusal(at({ stage: "Options", detached: [submitting()] }), startEvent({}, "ok", prepared)), "busy");
    assert.equal(refusal(at({ stage: "Options", recovery: { state: "unreadable", message: "bad" } }), startEvent({}, "ok", prepared)), "blocked");
    assert.equal(refusal(at({ stage: "Options", recovery: { state: "retained", command: command(PLAN_B) }, shown: shownA }), startEvent({}, "ok", prepared)), "blocked");
    assert.equal(refusal(at({ stage: "Options", recovery: { state: "retained", command: command(PLAN_A) } }), startEvent({}, "ok", prepared)), "blocked");
    assert.equal(refusal(at({ stage: "Input" }), startEvent({ next: "Options" }, "ok", prepared)), "not-here");
    assert.deepEqual(prepared, []);
    const named = moved(at({ stage: "Options", recovery: { state: "retained", command: command(PLAN_A) }, shown: shownA }), startEvent());
    assert.deepEqual(kinds(named), ["retain-and-submit"]);
  });

  it("start without a current plan requests one", () => {
    const result = moved(at({ stage: "Options", nextRequest: 9, problem: "old", shown: { ...shownA, for: OLD } }), startEvent());
    assert.deepEqual(result.next.activity, { kind: "planning", request: 9, for: FP });
    assert.equal(result.next.nextRequest, 10);
    assert.equal(result.next.problem, undefined);
    assert.deepEqual(result.effects, [{ kind: "request-plan", request: 9, planRequest: REQUEST }]);
  });

  it("start without a plan is blocked by step facts on Steps and by the input; missing references set the problem", () => {
    assert.equal(refusal(at({ stage: "Steps" }), startEvent({ stepsBlocked: true })), "blocked");
    assert.equal(refusal(at({ stage: "Options" }), startEvent({ inputBlocked: true })), "blocked");
    assert.equal(refusal(at({ stage: "Options", source: rerunReady() }), startEvent({ rerunInputBlocked: true })), "blocked");
    const references = moved(at({ stage: "Options" }), startEvent({ referencesUnavailable: true }));
    assert.equal(references.next.problem, REFERENCES_UNAVAILABLE);
    assert.deepEqual(references.next.activity, { kind: "idle" });
    assert.deepEqual(references.effects, []);
  });
});

describe("rerun warnings", () => {
  it("rerun Steps continue reads the warnings with the acknowledgment at dispatch", () => {
    const result = moved(at({ stage: "Steps", nextRequest: 4, problem: "p", source: rerunReady({ acknowledgment: HASH }) }), { type: "continue", gates: gates({ next: "Values" }) });
    assert.deepEqual(result.next.activity, { kind: "checking-warnings", request: 4, for: FP, acknowledgmentAtDispatch: HASH });
    assert.equal(result.next.problem, undefined);
    assert.equal(result.next.stage, "Steps");
    assert.deepEqual(result.effects, [{ kind: "check-warnings", request: 4 }]);
  });

  it("warnings that differ from the acknowledgment at dispatch move to Warning", () => {
    const state = at({ stage: "Steps", source: rerunReady({ acknowledgment: DIGEST }), activity: { kind: "checking-warnings", request: 4, for: FP, acknowledgmentAtDispatch: HASH } });
    const result = moved(state, { type: "warnings-settled", request: 4, warning: WARNING });
    assert.equal(result.next.stage, "Warning");
    assert.deepEqual(result.next.source, rerunReady({ acknowledgment: DIGEST, warning: WARNING }));
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.equal(refusal(state, { type: "warnings-settled", request: 5, warning: WARNING }), "superseded");
  });

  it("no warnings, or an acknowledged digest, records the digest and moves to Values", () => {
    const state = at({ stage: "Steps", source: rerunReady(), activity: { kind: "checking-warnings", request: 4, for: FP } });
    const result = moved(state, { type: "warnings-settled", request: 4, warning: NO_WARNING });
    assert.equal(result.next.stage, "Values");
    assert.deepEqual(result.next.source, rerunReady({ warning: NO_WARNING, acknowledgment: DIGEST }));
    const acknowledged = at({ stage: "Steps", source: rerunReady(), activity: { kind: "checking-warnings", request: 4, for: FP, acknowledgmentAtDispatch: DIGEST } });
    assert.equal(moved(acknowledged, { type: "warnings-settled", request: 4, warning: WARNING }).next.stage, "Values");
  });

  it("warnings-failed sets the problem", () => {
    const result = moved(at({ stage: "Steps", source: rerunReady(), activity: { kind: "checking-warnings", request: 4, for: FP } }), { type: "warnings-failed", request: 4, message: "down" });
    assert.equal(result.next.problem, "down");
    assert.deepEqual(result.next.activity, { kind: "idle" });
  });

  it("the Confirm button acknowledges unguarded and drops the plan", () => {
    const state = at({ stage: "Warning", shown: shownA, source: rerunReady({ warning: WARNING }), activity: submitting() });
    const result = moved(state, { type: "acknowledge", via: "button" });
    assert.equal(result.next.stage, "Values");
    assert.equal(result.next.shown, undefined);
    assert.deepEqual(result.next.source, rerunReady({ warning: WARNING, acknowledgment: DIGEST }));
    assert.equal(refusal(at({ stage: "Warning", source: rerunReady() }), { type: "acknowledge", via: "button" }), "not-here");
  });

  it("Enter acknowledges only when idle and without a saved submission", () => {
    const state = at({ stage: "Warning", source: rerunReady({ warning: WARNING }) });
    assert.equal(moved(state, { type: "acknowledge", via: "enter" }).next.stage, "Values");
    assert.equal(refusal({ ...state, activity: submitting() }, { type: "acknowledge", via: "enter" }), "busy");
    assert.equal(refusal({ ...state, recovery: { state: "retained", command: command(PLAN_A) } }, { type: "acknowledge", via: "enter" }), "blocked");
    assert.equal(refusal(at({ stage: "Warning", source: rerunReady() }), { type: "acknowledge", via: "enter" }), "not-here");
  });

  it("cancel-warning returns to Steps", () => {
    assert.equal(moved(at({ stage: "Warning", source: rerunReady({ warning: WARNING }) }), { type: "cancel-warning" }).next.stage, "Steps");
    assert.equal(refusal(at({ stage: "Options" }), { type: "cancel-warning" }), "not-here");
  });
});

describe("planning", () => {
  const planning = (patch: Partial<RunDialogState> = {}) => at({ stage: "Options", activity: { kind: "planning", request: 3, for: FP }, ...patch });

  it("a plan whose rerun warnings are unacknowledged shows and moves to Warning", () => {
    const rerunPlan = plan(PLAN_A, { rerun: { source: RERUN_PLAN_SOURCE, warnings: [REPEAT], warningDigest: DIGEST } });
    const prepared = command(PLAN_A);
    const result = moved(planning({ source: rerunReady(), recovery: { state: "retained", command: prepared, answer: { reply: ANSWER, for: FP } } }),
      { type: "plan-settled", request: 3, plan: rerunPlan, planRequest: REQUEST });
    assert.equal(result.next.stage, "Warning");
    assert.deepEqual(result.next.shown, { for: FP, plan: rerunPlan, request: REQUEST, expired: false });
    assert.deepEqual(result.next.recovery, { state: "retained", command: prepared });
    assert.deepEqual(result.next.source, rerunReady({ warning: { workflowId: rerunPlan.workflowId, rerun: rerunPlan.rerun! } }));
    assert.deepEqual(result.effects, []);
  });

  it("a clean plan stays on the last stage and starts itself; a stopped plan waits", () => {
    const clean = moved(planning(), { type: "plan-settled", request: 3, plan: plan(PLAN_A), planRequest: REQUEST });
    assert.equal(clean.next.stage, "Options");
    assert.deepEqual(clean.next.activity, { kind: "idle" });
    assert.deepEqual(clean.effects, [{ kind: "auto-start" }]);
    const refused = plan(PLAN_A, { refused: [{ entry: 2, code: "input-invalid", message: "Bad row." }] });
    assert.deepEqual(moved(planning(), { type: "plan-settled", request: 3, plan: refused, planRequest: REQUEST }).effects, []);
    assert.deepEqual(moved(planning(), { type: "plan-settled", request: 3, plan: plan(PLAN_A, { planned: [] }), planRequest: REQUEST }).effects, []);
    assert.deepEqual(moved(planning(), { type: "plan-settled", request: 3, plan: plan(PLAN_A, { omittedSteps: ["save"] }), planRequest: REQUEST }).effects, []);
  });

  it("plan-failed sets the problem", () => {
    const result = moved(planning({ shown: shownA }), { type: "plan-failed", request: 3, message: "no" });
    assert.equal(result.next.problem, "no");
    assert.equal(result.next.shown, shownA);
    assert.deepEqual(result.next.activity, { kind: "idle" });
  });
});

describe("start, replay and the outcome", () => {
  it("start with a replaced authority sets the problem and prepares nothing", () => {
    const prepared: string[] = [];
    const result = moved(at({ stage: "Options", shown: shownA }), startEvent({}, "replaced", prepared));
    assert.equal(result.next.problem, authorityText);
    assert.equal(result.next.prepared, undefined);
    assert.deepEqual(result.effects, []);
    assert.deepEqual(prepared, []);
  });

  it("start on a current plan prepares, captures the expiry request and count, and submits", () => {
    const prepared: string[] = [];
    const result = moved(at({ stage: "Options", shown: shownA, nextRequest: 7, problem: "p" }), startEvent({}, "ok", prepared));
    assert.deepEqual(prepared, [PLAN_A]);
    const sent = command(PLAN_A, "c2000000-0000-4000-8000-000000000002");
    assert.deepEqual(result.next.prepared, sent);
    assert.deepEqual(result.next.activity, { kind: "submitting", request: 7, for: FP, command: sent, plannedCount: 1, expiryRequest: REQUEST });
    assert.equal(result.next.problem, undefined);
    assert.deepEqual(result.effects, [{ kind: "retain-and-submit", request: 7, command: sent, plan: shownA.plan }]);
  });

  it("start reuses a prepared command for the same plan and then captures no expiry request", () => {
    const prepared: string[] = [];
    const earlier = command(PLAN_A);
    const result = moved(at({ stage: "Options", shown: shownA, prepared: earlier, nextRequest: 7 }), startEvent({}, "ok", prepared));
    assert.deepEqual(prepared, []);
    assert.deepEqual(result.next.activity, { kind: "submitting", request: 7, for: FP, command: earlier, plannedCount: 1 });
    const other = moved(at({ stage: "Options", shown: shownA, prepared: command(PLAN_B) }), startEvent({}, "ok", prepared));
    assert.deepEqual(prepared, [PLAN_A]);
    assert.ok(other.next.activity.kind === "submitting" && other.next.activity.expiryRequest === undefined);
  });

  it("start is blocked by an omission mismatch or nothing planned; refused entries do not block it", () => {
    assert.equal(refusal(at({ stage: "Options", shown: shownA }), startEvent({ omissionMismatch: true })), "blocked");
    assert.equal(refusal(at({ stage: "Options", shown: shownA }), startEvent({ plannedCount: 0 })), "blocked");
    const refused = { ...shownA, plan: plan(PLAN_A, { refused: [{ entry: 2, code: "input-invalid", message: "Bad row." }] }) };
    assert.deepEqual(kinds(moved(at({ stage: "Options", shown: refused }), startEvent())), ["retain-and-submit"]);
  });

  it("replay with a replaced authority sets the problem; the saved submission stays", () => {
    const recovery = { state: "retained", command: command(PLAN_A) } as const;
    const result = moved(at({ recovery }), { type: "replay", authority: { state: "replaced" } });
    assert.equal(result.next.problem, authorityText);
    assert.equal(result.next.recovery, recovery);
    assert.deepEqual(result.effects, []);
  });

  it("replay resends the saved command without an expiry request", () => {
    const saved = command(PLAN_A);
    const result = moved(at({ recovery: { state: "retained", command: saved }, nextRequest: 7 }), { type: "replay", authority: { state: "ok" } });
    assert.deepEqual(result.next.activity, { kind: "submitting", request: 7, for: FP, command: saved });
    assert.deepEqual(result.effects, [{ kind: "retain-and-submit", request: 7, command: saved }]);
    const withPlan = moved(at({ shown: shownA, recovery: { state: "retained", command: saved } }), { type: "replay", authority: { state: "ok" } });
    assert.ok(withPlan.next.activity.kind === "submitting" && withPlan.next.activity.plannedCount === 1);
    assert.equal(refusal(at({}), { type: "replay", authority: { state: "ok" } }), "not-here");
    assert.equal(refusal(at({ recovery: { state: "retained", command: saved, answer: { reply: ANSWER, for: FP } } }), { type: "replay", authority: { state: "ok" } }), "not-here");
    assert.equal(refusal(at({ recovery: { state: "retained", command: saved }, detached: [submitting()] }), { type: "replay", authority: { state: "ok" } }), "busy");
  });

  it("retained records the saved submission and keeps the request running; the answer stays for the same command", () => {
    const sent = command(PLAN_A);
    const result = moved(at({ activity: submitting(), recovery: { state: "retained", command: sent, answer: { reply: ANSWER, for: FP } } }), { type: "retained", request: 7 });
    assert.deepEqual(result.next.recovery, { state: "retained", command: sent, answer: { reply: ANSWER, for: FP } });
    assert.deepEqual(result.next.prepared, sent);
    assert.equal(result.next.activity.kind, "submitting");
    const fresh = moved(at({ activity: submitting(), recovery: { state: "retained", command: command(PLAN_B, "c3000000-0000-4000-8000-000000000003"), answer: { reply: ANSWER, for: FP } } }), { type: "retained", request: 7 });
    assert.deepEqual(fresh.next.recovery, { state: "retained", command: sent });
    assert.equal(refusal(at({ activity: submitting() }), { type: "retained", request: 8 }), "superseded");
  });

  it("submit-threw sets the problem; the saved submission and prepared stay", () => {
    const sent = command(PLAN_A);
    const result = moved(at({ activity: submitting(), prepared: sent, recovery: { state: "retained", command: sent } }), { type: "submit-threw", request: 7, message: "failed" });
    assert.equal(result.next.problem, "failed");
    assert.equal(result.next.prepared, sent);
    assert.deepEqual(result.next.recovery, { state: "retained", command: sent });
    assert.deepEqual(result.next.activity, { kind: "idle" });
  });

  it("landed closes the dialog and reports the captured count", () => {
    const sent = command(PLAN_A);
    const reply = applied(sent.commandId);
    const result = moved(at({ stage: "Options", shown: shownA, prepared: sent, activity: submitting({ plannedCount: 3 }), recovery: { state: "retained", command: sent } }),
      { type: "submit-settled", request: 7, view: { view: "landed", replayed: false }, reply });
    assert.equal(result.next.stage, "Input");
    assert.equal(result.next.shown, undefined);
    assert.equal(result.next.prepared, undefined);
    assert.deepEqual(result.next.recovery, { state: "none" });
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.deepEqual(result.effects, [{ kind: "dismiss-recovery", command: sent }, { kind: "feedback" }, { kind: "applied", workflowId: WORKFLOW, count: 3 }, { kind: "close-dialog" }]);
  });

  it("an expired plan with a captured request re-plans", () => {
    const sent = command(PLAN_A);
    const result = moved(at({ stage: "Options", shown: shownA, prepared: sent, activity: submitting({ expiryRequest: EXPIRY_REQUEST }), recovery: { state: "retained", command: sent } }),
      settled({ view: "rejected", feedback, code: "RUN_START_PLAN_EXPIRED" }));
    assert.equal(result.next.shown, undefined);
    assert.equal(result.next.prepared, undefined);
    assert.deepEqual(result.next.recovery, { state: "none" });
    assert.deepEqual(result.next.activity, { kind: "replanning", request: 7, for: FP, planRequest: EXPIRY_REQUEST });
    assert.deepEqual(result.effects, [{ kind: "dismiss-recovery", command: sent }, { kind: "request-plan", request: 7, planRequest: EXPIRY_REQUEST }]);
  });

  it("another rejection, a conflict, or an expiry without a captured request closes the dialog", () => {
    const sent = command(PLAN_A);
    for (const view of [{ view: "rejected", feedback, code: "RUN_START_PLAN_EXPIRED" }, { view: "rejected", feedback, code: "invalid-state" }, { view: "conflict", feedback }] as const) {
      const result = moved(at({ stage: "Options", shown: shownA, prepared: sent, activity: submitting(), recovery: { state: "retained", command: sent } }), settled(view));
      assert.equal(result.next.stage, "Input");
      assert.deepEqual(result.next.recovery, { state: "none" });
      assert.equal(result.next.prepared, undefined);
      assert.deepEqual(result.effects, [{ kind: "dismiss-recovery", command: sent }, { kind: "feedback" }, { kind: "close-dialog" }]);
    }
  });

  it("confirmation-required sets the problem and records the answer", () => {
    const sent = command(PLAN_A);
    const result = moved(at({ stage: "Options", activity: submitting(), recovery: { state: "retained", command: sent } }),
      settled({ view: "confirmation-required", feedback, warningDigest: HASH }, ANSWER));
    assert.equal(result.next.problem, feedback.text);
    assert.deepEqual(result.next.recovery, { state: "retained", command: sent, answer: { reply: ANSWER, for: FP } });
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.deepEqual(result.effects, [{ kind: "feedback" }]);
  });

  it("superseded, unknown, call-refused and not-sent set the problem only", () => {
    const sent = command(PLAN_A);
    for (const view of [{ view: "superseded", feedback }, { view: "unknown", feedback }, { view: "call-refused", feedback }, { view: "not-sent", feedback }] as const) {
      const result = moved(at({ stage: "Options", shown: shownA, prepared: sent, activity: submitting(), recovery: { state: "retained", command: sent } }), settled(view));
      assert.equal(result.next.problem, feedback.text);
      assert.deepEqual(result.next.recovery, { state: "retained", command: sent });
      assert.equal(result.next.shown, shownA);
      assert.deepEqual(result.effects, [{ kind: "feedback" }]);
    }
  });

  it("a re-plan shows the expired plan without starting it, or moves to Warning", () => {
    const replanning = { kind: "replanning", request: 7, for: FP, planRequest: EXPIRY_REQUEST } as const;
    const result = moved(at({ stage: "Options", activity: replanning }), { type: "plan-settled", request: 7, plan: plan(PLAN_B), planRequest: EXPIRY_REQUEST });
    assert.deepEqual(result.next.shown, { for: FP, plan: plan(PLAN_B), request: EXPIRY_REQUEST, expired: true });
    assert.equal(result.next.stage, "Options");
    assert.deepEqual(result.effects, []);
    const rerunPlan = plan(PLAN_B, { rerun: { source: RERUN_PLAN_SOURCE, warnings: [REPEAT], warningDigest: DIGEST } });
    assert.equal(moved(at({ stage: "Options", source: rerunReady(), activity: replanning }), { type: "plan-settled", request: 7, plan: rerunPlan, planRequest: EXPIRY_REQUEST }).next.stage, "Warning");
  });

  it("a failed re-plan closes with the refusal toast", () => {
    const result = moved(at({ stage: "Options", activity: { kind: "replanning", request: 7, for: FP, planRequest: EXPIRY_REQUEST } }), { type: "plan-failed", request: 7, message: "down" });
    assert.equal(result.next.stage, "Input");
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.deepEqual(result.effects, [{ kind: "close-dialog" }, { kind: "refusal-toast" }]);
  });
});

describe("binding change", () => {
  it("moves reads into detached and drops every submit and re-plan", () => {
    const read = { kind: "planning", request: 3, for: FP } as const;
    const warnings = { kind: "checking-warnings", request: 4, for: FP } as const;
    const replanning = { kind: "replanning", request: 5, for: FP, planRequest: REQUEST } as const;
    assert.deepEqual(moved(at({ activity: read }), { type: "binding-changed" }).next, at({ activity: { kind: "idle" }, detached: [read] }));
    assert.deepEqual(moved(at({ activity: submitting(), detached: [warnings, replanning] }), { type: "binding-changed" }).next,
      at({ activity: { kind: "idle" }, detached: [warnings] }));
    assert.equal(refusal(at({ activity: { kind: "idle" } }), { type: "submit-settled", request: 7, view: { view: "landed", replayed: false } }), "superseded");
  });
});

describe("settlement", () => {
  const terminal: readonly RunDialogEvent[] = [
    { type: "plan-settled", request: 99, plan: plan(PLAN_A), planRequest: REQUEST },
    { type: "plan-failed", request: 99, message: "x" },
    { type: "warnings-settled", request: 99, warning: WARNING },
    { type: "warnings-failed", request: 99, message: "x" },
    { type: "submit-settled", request: 99, view: { view: "landed", replayed: false } },
    { type: "submit-threw", request: 99, message: "x" },
    { type: "retained", request: 99 },
  ];

  it("a settlement for a number nobody owns is superseded and changes nothing", () => {
    const state = at({ activity: { kind: "planning", request: 1, for: FP }, detached: [submitting({ request: 2 })] });
    for (const event of terminal) assert.equal(refusal(state, event), "superseded", event.type);
  });

  it("an owned settlement made for another fingerprint releases busy and drops its payload", () => {
    const planned = moved(at({ stage: "Options", shown: shownA, activity: { kind: "planning", request: 3, for: OLD } }), { type: "plan-settled", request: 3, plan: plan(PLAN_B), planRequest: REQUEST });
    assert.deepEqual(planned.next, at({ stage: "Options", shown: shownA }));
    assert.deepEqual(planned.effects, []);
    const sent = command(PLAN_A);
    const landed = moved(at({ stage: "Options", prepared: sent, activity: submitting({ for: OLD }), recovery: { state: "retained", command: sent } }),
      { type: "submit-settled", request: 7, view: { view: "landed", replayed: false } });
    assert.deepEqual(landed.next, at({ stage: "Options", prepared: sent, recovery: { state: "retained", command: sent } }));
    assert.deepEqual(landed.effects, []);
    const expired = moved(at({ activity: submitting({ for: OLD, expiryRequest: REQUEST }) }), settled({ view: "rejected", feedback, code: "RUN_START_PLAN_EXPIRED" }));
    assert.deepEqual(expired.next.activity, { kind: "idle" });
    assert.deepEqual(expired.effects, []);
  });

  it("a detached completion moves the running activity into detached and releases busy", () => {
    const pending = submitting();
    const result = moved(at({ stage: "Options", activity: pending, detached: [{ kind: "planning", request: 3, for: FP }] }), { type: "plan-settled", request: 3, plan: plan(PLAN_A), planRequest: REQUEST });
    assert.deepEqual(result.next.activity, { kind: "idle" });
    assert.deepEqual(result.next.detached, [pending]);
    assert.equal(result.next.shown?.plan.startPlanId, PLAN_A);
    assert.equal(refusal(result.next, startEvent()), "busy");
    assert.equal(moved(result.next, { type: "submit-settled", request: 7, view: { view: "landed", replayed: false } }).next.stage, "Input");
  });
});

describe("visibleRunDialog", () => {
  it("drops a plan and an answer made for another fingerprint", () => {
    const sent = command(PLAN_A);
    const state = at({ shown: { ...shownA, for: OLD }, recovery: { state: "retained", command: sent, answer: { reply: ANSWER, for: OLD } } });
    const view = visibleRunDialog(state, FP);
    assert.equal(view.shown, undefined);
    assert.deepEqual(view.recovery, { state: "retained", command: sent });
    const current = at({ shown: shownA });
    assert.equal(visibleRunDialog(current, FP), current);
  });
});

describe("runDialogControls", () => {
  it("labels the primary button by stage and plan", () => {
    assert.equal(runDialogControls(at({ stage: "Input" }), gates({ next: "Options" })).primary.label, "Continue");
    assert.equal(runDialogControls(at({ stage: "Options" }), LAST).primary.label, "Start run");
    assert.equal(runDialogControls(at({ stage: "Options" }), gates({ dryRun: true })).primary.label, "Start dry run");
    assert.equal(runDialogControls(at({ stage: "Options" }), gates({ dryRun: false })).primary.label, "Start live run");
    const two = { ...shownA, plan: plan(PLAN_A, { planned: [plan(PLAN_A).planned[0], { logicalKey: "entry:2", title: "Grace Hopper", matchKey: "eid:E2" }] }) };
    assert.equal(runDialogControls(at({ stage: "Options", shown: two }), LAST).primary.label, "Start 2 runs");
    assert.equal(runDialogControls(at({ stage: "Options", shown: shownA, source: rerunReady() }), LAST).primary.label, "Create rerun");
    const warning = runDialogControls(at({ stage: "Warning", source: rerunReady({ warning: WARNING }) }), gates({ next: "Values" }));
    assert.equal(warning.primary.label, "Confirm");
    assert.deepEqual(warning.cancel, { type: "cancel-warning" });
    assert.equal(warning.back, null);
  });

  it("shares the button, hint and Enter with the transition's admission", () => {
    const busy = runDialogControls(at({ stage: "Options", activity: { kind: "planning", request: 1, for: FP } }), LAST);
    assert.equal(busy.primary.enabled, false);
    assert.equal(busy.primary.loading, true);
    assert.equal(busy.enter, null);
    assert.equal(busy.hint, null);
    const ready = runDialogControls(at({ stage: "Options" }), LAST);
    assert.equal(ready.primary.enabled, true);
    assert.equal(ready.hint, "Enter to start");
    assert.equal(ready.back, "Input");
    const input = { gates: LAST, authority: { state: "ok" }, planRequest: () => REQUEST, prepare: () => command(PLAN_A) } as const;
    assert.equal(ready.primary.event(input).type, "start");
    assert.equal(runDialogControls(at({ stage: "Input" }), gates({ next: "Options", inputBlocked: true })).primary.enabled, false);
  });
});

describe("useRunDialogMachine", () => {
  it("Start plans, starts the clean plan after it renders, and closes when it lands", async () => {
    const calls: string[] = [];
    const sent = command(PLAN_A);
    const outcome: CommandOutcome = { kind: "confirmed", commandId: sent.commandId, readback: {},
      reply: applied(sent.commandId) };
    let send: ((event: RunDialogEvent) => RunDialogStep) | undefined;
    let seen: RunDialogState | undefined;
    function Probe() {
      const [stage, setStage] = useState<RunStartStage>("Options");
      const effects: RunDialogEffects = {
        loadSource: () => Promise.reject(new Error("unused")), restoreSource: () => {},
        requestPlan: request => { calls.push(`plan ${String(request.dryRun)}`); return Promise.resolve(plan(PLAN_A)); },
        checkWarnings: () => Promise.reject(new Error("unused")),
        retain: retained => { calls.push(`retain ${retained.target.startPlanId}`); return undefined; },
        submit: () => { calls.push("submit"); return Promise.resolve(outcome); },
        dismissRecovery: () => calls.push("dismiss"), feedback: settled => calls.push(`feedback ${settled.kind}`),
        applied: (workflowId, count) => calls.push(`applied ${workflowId} ${String(count)}`),
        closeDialog: () => calls.push("close"), refusalToast: () => calls.push("toast"),
        autoStart: () => { const result = send?.(startEvent()); calls.push(`auto-start ${result !== undefined && "refused" in result ? result.refused : "sent"}`); },
      };
      const machine = useRunDialogMachine({ stage, setStage, fingerprint: FP, effects });
      send = machine.send;
      seen = machine.state;
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(Probe)); });
      await act(async () => { send?.(startEvent()); });
      await act(async () => { await Promise.resolve(); });
      assert.deepEqual(calls, ["plan false", "retain " + PLAN_A, "submit", "auto-start sent", "dismiss", "feedback confirmed", `applied ${WORKFLOW} 1`, "close"]);
      assert.equal(seen?.stage, "Input");
      assert.deepEqual(seen?.recovery, { state: "none" });
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});
