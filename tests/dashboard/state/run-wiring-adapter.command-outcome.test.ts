import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import { commandAttemptView } from "../../../src/dashboard/app/commands/command-outcome.js";
import { runCommandRefreshesDay as refreshes, runCommandState as state } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from "../../../src/models/failures/error-catalog.js";
import { BulkRunCommandOutcomeSchema, CommandResultSchema } from "../../../src/rules/commands/commands.js";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const COMMAND = id(10);
const RUN = id(1);
const runState = (outcome: CommandOutcome) => state(commandAttemptView(outcome));
const runRefreshes = (outcome: CommandOutcome, type: string) => refreshes(commandAttemptView(outcome), type);
const fb = (code: ErrorCatalogCode) => formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
const applied = CommandResultSchema.parse({ state: "applied", commandId: COMMAND, affectedTargets: [{ family: "run", runId: RUN }] });
const rejected = CommandResultSchema.parse({ state: "rejected", commandId: COMMAND, code: "invalid-state", message: "changed" });

/** Outcomes whose effect is unknown, whatever `kind` they carry. */
const UNKNOWN: readonly { readonly name: string; readonly outcome: CommandOutcome }[] = [
  { name: "uncertain transport", outcome: { kind: "uncertain", commandId: COMMAND, cause: new Error("lost"), feedback: fb("COMMAND_OUTCOME_UNCERTAIN") } },
  { name: "refused kind over a pending reply", outcome: { kind: "refused", commandId: COMMAND, reply: CommandResultSchema.parse({ state: "pending", commandId: COMMAND }), feedback: fb("COMMAND_REFUSED") } },
  { name: "refused kind over an errored rejection", outcome: { kind: "refused", commandId: COMMAND, reply: CommandResultSchema.parse({ state: "rejected", commandId: COMMAND, code: "bulk-child-errored", message: "private" }), feedback: fb("COMMAND_REFUSED") } },
  { name: "refused kind over an errored bulk child", outcome: { kind: "refused", commandId: id(14), reply: BulkRunCommandOutcomeSchema.parse({ outcome: "errored", runId: RUN, commandId: id(14), detail: "private" }), feedback: fb("COMMAND_REFUSED") } },
];

describe("run wiring reads the shared command outcome", () => {
  for (const { name, outcome } of UNKNOWN) {
    it(`shows an unknown outcome as uncertain and never refreshes the day for it: ${name}`, () => {
      assert.equal(runState(outcome), "uncertain");
      assert.equal(runRefreshes(outcome, "resolve-workbook-row"), false);
    });
  }

  it("shows a pending attempt as pending", () => {
    assert.equal(state({ view: "pending" }), "pending");
  });

  it("shows a confirmed command as settled and refreshes the day", () => {
    const confirmed: CommandOutcome = { kind: "confirmed", commandId: COMMAND, reply: applied, readback: {} };
    assert.equal(runState(confirmed), "settled");
    assert.equal(runRefreshes(confirmed, "retry"), true);
  });

  it("keeps a landed command whose target moved on as refused", () => {
    assert.equal(runState({ kind: "conflict", commandId: COMMAND, reply: applied, feedback: fb("COMMAND_REFUSED") }), "refused");
  });

  it("shows a refusal as refused and refreshes the day only for the two workbook resolves", () => {
    const refusal: CommandOutcome = { kind: "refused", commandId: COMMAND, reply: rejected, feedback: fb("COMMAND_REFUSED") };
    const notSent: CommandOutcome = { kind: "refused", commandId: COMMAND, reason: "not-attempted", feedback: fb("COMMAND_REFUSED") };
    assert.equal(runState(refusal), "refused");
    assert.equal(runState(notSent), "refused");
    assert.equal(runRefreshes(refusal, "resolve-workbook-row"), true);
    assert.equal(runRefreshes(notSent, "resolve-workbook-reference-row"), true);
    assert.equal(runRefreshes(refusal, "retry"), false);
    assert.equal(runRefreshes({ kind: "failed", commandId: COMMAND, feedback: fb("COMMAND_REFUSED") }, "resolve-workbook-row"), false);
  });
});
