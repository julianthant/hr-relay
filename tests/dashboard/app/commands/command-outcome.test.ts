import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { attemptTransition, attemptUnresolved, commandAttemptView, outcomeEffect, type AttemptEvent, type AttemptPhase, type CommandAttemptView } from "../../../../src/dashboard/app/commands/command-outcome.js";
import type { CommandExecutionScope, CommandOutcome, RetainedCommandAttempt } from "../../../../src/dashboard/app/commands/command-executor.js";
import type { SharedCommands } from "../../../../src/dashboard/client/commands/shared-commands.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from "../../../../src/models/failures/error-catalog.js";
import { BulkRunCommandOutcomeSchema, BulkRunCommandResponseSchema, CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const RUN = id(1);
const COMMAND = id(10);
const fb = (code: ErrorCatalogCode) => formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
const UNCERTAIN = { ...fb("COMMAND_OUTCOME_UNCERTAIN"), text: "Not confirmed yet." };

const applied = CommandResultSchema.parse({ state: "applied", commandId: COMMAND, affectedTargets: [{ family: "run", runId: RUN }] });
const replayed = CommandResultSchema.parse({ ...applied, state: "already-applied" });
const conflictReply = CommandResultSchema.parse({ state: "conflict", commandId: COMMAND, currentVersion: 4, message: "private" });
const confirmReply = CommandResultSchema.parse({ state: "confirmation-required", commandId: COMMAND, warningDigest: "d".repeat(64), message: "private" });
const rejectedReply = CommandResultSchema.parse({ state: "rejected", commandId: COMMAND, code: "policy-refused", message: "private" });
const erroredRejection = CommandResultSchema.parse({ state: "rejected", commandId: COMMAND, code: "bulk-child-errored", message: "private" });
const pendingReply = CommandResultSchema.parse({ state: "pending", commandId: COMMAND });
const childApplied = BulkRunCommandOutcomeSchema.parse({ outcome: "applied", runId: RUN, commandId: id(11), replayed: false, detail: "private" });
const childConflict = BulkRunCommandOutcomeSchema.parse({ outcome: "conflict", runId: RUN, commandId: id(12), currentVersion: 3, detail: "private" });
const childRefused = BulkRunCommandOutcomeSchema.parse({ outcome: "refused", runId: RUN, commandId: id(13), code: "invalid-state", detail: "private" });
const childErrored = BulkRunCommandOutcomeSchema.parse({ outcome: "errored", runId: RUN, commandId: id(14), detail: "private" });

const vectorReply = BulkRunCommandResponseSchema.parse({ state: "vector", bulkCommandId: COMMAND, type: "cancel", requestedCount: 2, results: [childApplied, childConflict] });

const confirmed: CommandOutcome = { kind: "confirmed", commandId: COMMAND, reply: applied, readback: {} };
const notAttempted: CommandOutcome = { kind: "refused", commandId: id(15), reason: "not-attempted", feedback: fb("COMMAND_REFUSED") };
const childConfirmed: CommandOutcome = { kind: "confirmed", commandId: id(11), reply: childApplied, readback: {} };
const childConflicted: CommandOutcome = { kind: "conflict", commandId: id(12), reply: childConflict, feedback: fb("COMMAND_CONFLICT") };
const childRejected: CommandOutcome = { kind: "refused", commandId: id(13), reply: childRefused, feedback: fb("COMMAND_REFUSED") };
const childUnknown: CommandOutcome = { kind: "uncertain", commandId: id(14), reply: childErrored, cause: childErrored, feedback: UNCERTAIN };

/** Each case: the outcome, its effect and the view a surface must show, all written out by hand. */
const CASES: readonly { readonly name: string; readonly outcome: CommandOutcome; readonly effect: ReturnType<typeof outcomeEffect>; readonly view: CommandAttemptView }[] = [
  { name: "confirmed single", outcome: confirmed, effect: "landed", view: { view: "landed", replayed: false } },
  { name: "confirmed replay", outcome: { ...confirmed, reply: replayed }, effect: "landed", view: { view: "landed", replayed: true } },
  { name: "confirmed replayed bulk child", outcome: { ...childConfirmed, reply: BulkRunCommandOutcomeSchema.parse({ ...childApplied, replayed: true }) }, effect: "landed", view: { view: "landed", replayed: true } },
  { name: "superseded single", outcome: { kind: "conflict", commandId: COMMAND, reply: applied, readback: {}, feedback: fb("COMMAND_CONFLICT") },
    effect: "landed", view: { view: "superseded", feedback: fb("COMMAND_CONFLICT") } },
  { name: "superseded bulk child", outcome: { kind: "conflict", commandId: id(11), reply: childApplied, readback: {}, feedback: fb("COMMAND_CONFLICT") },
    effect: "landed", view: { view: "superseded", feedback: fb("COMMAND_CONFLICT") } },
  { name: "conflict single", outcome: { kind: "conflict", commandId: COMMAND, reply: conflictReply, feedback: fb("COMMAND_CONFLICT") },
    effect: "none", view: { view: "conflict", feedback: fb("COMMAND_CONFLICT"), currentVersion: 4 } },
  { name: "conflict bulk child", outcome: childConflicted, effect: "none", view: { view: "conflict", feedback: fb("COMMAND_CONFLICT"), currentVersion: 3 } },
  { name: "confirmation required", outcome: { kind: "confirmation-required", commandId: COMMAND, reply: confirmReply, warningDigest: "d".repeat(64), feedback: fb("COMMAND_CONFIRMATION_REQUIRED") },
    effect: "none", view: { view: "confirmation-required", feedback: fb("COMMAND_CONFIRMATION_REQUIRED"), warningDigest: "d".repeat(64) } },
  { name: "kernel rejection", outcome: { kind: "refused", commandId: COMMAND, reply: rejectedReply, feedback: fb("COMMAND_REFUSED") },
    effect: "none", view: { view: "rejected", feedback: fb("COMMAND_REFUSED"), code: "policy-refused" } },
  { name: "bulk child refusal", outcome: childRejected, effect: "none", view: { view: "rejected", feedback: fb("COMMAND_REFUSED"), code: "invalid-state" } },
  { name: "refused bulk response", outcome: { kind: "refused", commandId: COMMAND, reply: { state: "refused", code: "policy-refused", message: "private" }, feedback: fb("COMMAND_REFUSED") },
    effect: "none", view: { view: "rejected", feedback: fb("COMMAND_REFUSED"), code: "policy-refused" } },
  { name: "stale worker conflict settled as refused", outcome: { kind: "refused", commandId: COMMAND, reply: CommandResultSchema.parse({ ...conflictReply, message: "WORKER_TARGET_STALE" }), feedback: fb("WORKER_TARGET_STALE") },
    effect: "none", view: { view: "rejected", feedback: fb("WORKER_TARGET_STALE"), code: "WORKER_TARGET_STALE" } },
  { name: "local lock refusal", outcome: { kind: "refused", commandId: COMMAND, reason: "locked", feedback: fb("COMMAND_REFUSED") },
    effect: "none", view: { view: "call-refused", feedback: fb("COMMAND_REFUSED"), reason: "locked" } },
  { name: "before-effect refusal", outcome: { kind: "refused", commandId: COMMAND, cause: new Error("origin refused"), feedback: fb("COMMAND_REFUSED") },
    effect: "none", view: { view: "call-refused", feedback: fb("COMMAND_REFUSED"), reason: "before-effect" } },
  { name: "not sent", outcome: { kind: "failed", commandId: "", feedback: fb("COMMAND_DISPATCH_FAILED") },
    effect: "none", view: { view: "not-sent", feedback: fb("COMMAND_DISPATCH_FAILED") } },
  { name: "uncertain transport", outcome: { kind: "uncertain", commandId: COMMAND, cause: new Error("lost"), feedback: UNCERTAIN },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "uncertain pending reply", outcome: { kind: "uncertain", commandId: COMMAND, reply: pendingReply, cause: pendingReply, feedback: UNCERTAIN },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "uncertain errored bulk child", outcome: childUnknown, effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "refused kind over an errored rejection is still unknown", outcome: { kind: "refused", commandId: COMMAND, reply: erroredRejection, feedback: fb("COMMAND_REFUSED") },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "refused kind over a pending reply is still unknown", outcome: { kind: "refused", commandId: COMMAND, reply: pendingReply, feedback: fb("COMMAND_REFUSED") },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "refused kind over an errored bulk child is still unknown", outcome: { kind: "refused", commandId: id(14), reply: childErrored, feedback: fb("COMMAND_REFUSED") },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "confirmed bulk parent", outcome: { kind: "confirmed", commandId: COMMAND, reply: vectorReply, children: [childConfirmed, childConfirmed], readback: [{}, {}] },
    effect: "landed", view: { view: "landed", replayed: false, children: [{ view: "landed", replayed: false }, { view: "landed", replayed: false }] } },
  { name: "mixed bulk parent", outcome: { ...childConflicted, commandId: COMMAND, reply: vectorReply, children: [childConfirmed, childConflicted, notAttempted] },
    effect: "mixed", view: { view: "bulk", effect: "mixed", kind: "conflict", feedback: fb("COMMAND_CONFLICT"),
      children: [{ view: "landed", replayed: false }, { view: "conflict", feedback: fb("COMMAND_CONFLICT"), currentVersion: 3 },
        { view: "call-refused", feedback: fb("COMMAND_REFUSED"), reason: "not-attempted" }],
      classes: ["applied", "conflict", "not-attempted"] } },
  { name: "refused bulk parent", outcome: { ...childRejected, commandId: COMMAND, reply: vectorReply, children: [childRejected, notAttempted] },
    effect: "none", view: { view: "bulk", effect: "none", kind: "refused", feedback: fb("COMMAND_REFUSED"),
      children: [{ view: "rejected", feedback: fb("COMMAND_REFUSED"), code: "invalid-state" }, { view: "call-refused", feedback: fb("COMMAND_REFUSED"), reason: "not-attempted" }],
      classes: ["refused", "not-attempted"] } },
  { name: "bulk parent whose landed children were superseded", outcome: { kind: "conflict", commandId: COMMAND, reply: vectorReply, feedback: fb("COMMAND_CONFLICT"),
    children: [{ kind: "conflict", commandId: id(11), reply: childApplied, readback: {}, feedback: fb("COMMAND_CONFLICT") }, childConfirmed] },
    effect: "landed", view: { view: "bulk", effect: "landed", kind: "conflict", feedback: fb("COMMAND_CONFLICT"),
      children: [{ view: "superseded", feedback: fb("COMMAND_CONFLICT") }, { view: "landed", replayed: false }], classes: ["applied", "applied"] } },
  { name: "bulk parent with an unknown child", outcome: { ...childUnknown, commandId: COMMAND, reply: vectorReply, children: [childConfirmed, childUnknown] },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
  { name: "conflict-kind bulk parent with an unknown child", outcome: { ...childConflicted, commandId: COMMAND, reply: vectorReply, children: [childConflicted, childUnknown] },
    effect: "unknown", view: { view: "unknown", feedback: UNCERTAIN } },
];

const REFUSAL_VIEWS = new Set(["rejected", "call-refused", "conflict", "confirmation-required", "not-sent"]);
function assertUnknownNeverRefused(outcome: CommandOutcome, view: CommandAttemptView, path: string): void {
  const effect = outcomeEffect(outcome);
  if (REFUSAL_VIEWS.has(view.view)) assert.equal(effect, "none", `${path}: a ${view.view} view needs effect none`);
  if (effect === "unknown") assert.equal(view.view, "unknown", `${path}: an unknown effect is shown as unknown`);
  const children = outcome.children ?? [];
  const childViews = view.view === "bulk" || view.view === "landed" ? view.children ?? [] : [];
  if (view.view !== "unknown") assert.equal(childViews.length, children.length, `${path}: every child has a view`);
  childViews.forEach((child, index) => { assertUnknownNeverRefused(children[index], child, `${path}[${String(index)}]`); });
}

describe("outcomeEffect and commandAttemptView", () => {
  for (const { name, outcome, effect, view } of CASES) {
    it(`reads ${name} from its evidence`, () => {
      assert.equal(outcomeEffect(outcome), effect);
      assert.deepEqual(commandAttemptView(outcome), view);
      assertUnknownNeverRefused(outcome, commandAttemptView(outcome), name);
    });
  }

  it("throws a named error for a vector reply that carries no child outcomes", () => {
    assert.throws(() => outcomeEffect({ kind: "conflict", commandId: COMMAND, reply: vectorReply, feedback: fb("COMMAND_CONFLICT") }), { name: "CommandOutcomeInvalidError" });
  });
});

describe("retained attempts", () => {
  const request = CommandRequestSchema.parse({ commandId: COMMAND, requestedAt: "2026-08-03T12:00:00.000Z", requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "cancel", target: { runId: RUN, expectedVersion: 1 } });
  const client: SharedCommands = {
    executeCommand: () => Promise.reject(new Error("fixture-client-unused")),
    executeBulkCommand: () => Promise.reject(new Error("fixture-client-unused")),
  };
  const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const attempt = (state: RetainedCommandAttempt["state"], outcome?: CommandOutcome): RetainedCommandAttempt =>
    ({ request, body: JSON.stringify(request), scope, state, ...(outcome === undefined ? {} : { outcome }) });

  it("shows a pending attempt, or one with no outcome yet, as pending and unresolved", () => {
    assert.deepEqual(commandAttemptView(attempt("pending", confirmed)), { view: "pending" });
    assert.deepEqual(commandAttemptView(attempt("settled")), { view: "pending" });
    assert.equal(attemptUnresolved(attempt("pending", confirmed)), true);
    assert.equal(attemptUnresolved(attempt("settled")), true);
  });

  it("shows a settled attempt through its outcome and is unresolved only for an unknown effect", () => {
    assert.deepEqual(commandAttemptView(attempt("settled", confirmed)), { view: "landed", replayed: false });
    for (const { name, outcome, effect } of CASES) assert.equal(attemptUnresolved(attempt("settled", outcome)), effect === "unknown", name);
  });
});

describe("attemptTransition", () => {
  const conflicted: CommandOutcome = { kind: "conflict", commandId: COMMAND, reply: conflictReply, feedback: fb("COMMAND_CONFLICT") };
  const rejected: CommandOutcome = { kind: "refused", commandId: COMMAND, reply: rejectedReply, feedback: fb("COMMAND_REFUSED") };
  const refusedUnknown: CommandOutcome = { kind: "refused", commandId: COMMAND, reply: erroredRejection, feedback: fb("COMMAND_REFUSED") };
  const unknown: CommandOutcome = { kind: "uncertain", commandId: COMMAND, reply: pendingReply, cause: pendingReply, feedback: UNCERTAIN };
  const reply = (via: "dispatch" | "check", outcome: CommandOutcome, scopeCurrent = true): AttemptEvent => ({ type: "reply", via, outcome, scopeCurrent });
  const wrapped = (inner: CommandOutcome): CommandOutcome => ({ kind: "uncertain", commandId: COMMAND, feedback: UNCERTAIN, cause: inner, ...(inner.reply === undefined ? {} : { reply: inner.reply }) });

  const ROWS: readonly { readonly from: AttemptPhase; readonly event: AttemptEvent; readonly step: ReturnType<typeof attemptTransition>; readonly name: string }[] = [
    { name: "a draft is created unregistered", from: "absent", event: { type: "create" }, step: { phase: "absent", release: "none" } },
    { name: "a fresh dispatch goes pending", from: "absent", event: { type: "dispatch", origin: "execute" }, step: { phase: "pending", release: "none" } },
    { name: "replay of an unknown id", from: "absent", event: { type: "dispatch", origin: "replay" }, step: { refused: "attempt-unavailable" } },
    { name: "check of an unknown id", from: "absent", event: { type: "check", retained: { view: "pending" } }, step: { refused: "attempt-unavailable" } },
    { name: "replay re-sends a settled attempt", from: "settled", event: { type: "dispatch", origin: "replay" }, step: { phase: "pending", release: "none" } },
    { name: "dispatch over a pending attempt", from: "pending", event: { type: "dispatch", origin: "replay" }, step: { refused: "locked" } },
    { name: "check over a pending attempt", from: "pending", event: { type: "check", retained: { view: "pending" } }, step: { refused: "locked" } },
    { name: "check of an unknown attempt", from: "settled", event: { type: "check", retained: { view: "unknown", feedback: UNCERTAIN } }, step: { phase: "pending", release: "none" } },
    { name: "check of a landed attempt", from: "settled", event: { type: "check", retained: { view: "landed", replayed: false } }, step: { refused: "locked" } },
    { name: "check of a rejected attempt", from: "settled", event: { type: "check", retained: { view: "rejected", feedback: fb("COMMAND_REFUSED"), code: "invalid-state" } }, step: { refused: "locked" } },
    { name: "a dispatch reply settles as it is", from: "pending", event: reply("dispatch", conflicted), step: { phase: "settled", outcome: conflicted, release: "settled-children" } },
    { name: "a dispatch reply after scope change keeps a confirmed result", from: "pending", event: reply("dispatch", confirmed, false), step: { phase: "settled", outcome: confirmed, release: "settled-children" } },
    { name: "a confirmed check releases", from: "pending", event: reply("check", confirmed), step: { phase: "settled", outcome: confirmed, release: "all" } },
    { name: "a recorded rejection on check releases", from: "pending", event: reply("check", rejected), step: { phase: "settled", outcome: rejected, release: "all" } },
    { name: "a conflict on check stays checkable", from: "pending", event: reply("check", conflicted), step: { phase: "settled", outcome: wrapped(conflicted), release: "none" } },
    { name: "an unknown check stays checkable", from: "pending", event: reply("check", unknown), step: { phase: "settled", outcome: wrapped(unknown), release: "none" } },
    { name: "a refused kind over an unknown reply on check stays checkable", from: "pending", event: reply("check", refusedUnknown), step: { phase: "settled", outcome: wrapped(refusedUnknown), release: "none" } },
    { name: "a check reply after scope change is unknown", from: "pending", event: reply("check", confirmed, false),
      step: { phase: "settled", outcome: { kind: "uncertain", commandId: COMMAND, feedback: UNCERTAIN, cause: "scope-replaced" }, release: "none" } },
  ];
  for (const { name, from, event, step } of ROWS) {
    it(`${from} + ${event.type}: ${name}`, () => { assert.deepEqual(attemptTransition(from, event), step); });
  }

  const INVALID: readonly [AttemptPhase, AttemptEvent][] = [
    ["pending", { type: "create" }], ["settled", { type: "create" }], ["settled", { type: "dispatch", origin: "execute" }],
    ["absent", reply("dispatch", confirmed)], ["settled", reply("check", confirmed)],
  ];
  for (const [from, event] of INVALID) {
    it(`throws a named error for ${from} + ${event.type}${event.type === "dispatch" ? ` (${event.origin})` : ""}`, () => {
      assert.throws(() => attemptTransition(from, event), { name: "AttemptTransitionInvalidError" });
    });
  }
});
