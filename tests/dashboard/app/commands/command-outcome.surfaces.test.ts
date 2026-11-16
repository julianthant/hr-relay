import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commandSaveState } from "../../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import type { CommandExecutionScope, CommandOutcome, RetainedCommandAttempt } from "../../../../src/dashboard/app/commands/command-executor.js";
import { attemptUnresolved } from "../../../../src/dashboard/app/commands/command-outcome.js";
import type { SharedCommands } from "../../../../src/dashboard/client/commands/shared-commands.js";
import { reviewAttemptState } from "../../../../src/dashboard/state/review-wiring-adapter.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from "../../../../src/models/failures/error-catalog.js";
import { BulkRunCommandOutcomeSchema, CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const COMMAND = id(10);
const fb = (code: ErrorCatalogCode) => formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));

/** Outcomes whose effect is unknown, whatever `kind` they carry: the shared outcome reads each as unknown. */
const UNKNOWN: readonly { readonly name: string; readonly outcome: CommandOutcome }[] = [
  { name: "uncertain transport", outcome: { kind: "uncertain", commandId: COMMAND, cause: new Error("lost"), feedback: fb("COMMAND_OUTCOME_UNCERTAIN") } },
  { name: "refused kind over a pending reply", outcome: { kind: "refused", commandId: COMMAND, reply: CommandResultSchema.parse({ state: "pending", commandId: COMMAND }), feedback: fb("COMMAND_REFUSED") } },
  { name: "refused kind over an errored rejection", outcome: { kind: "refused", commandId: COMMAND, reply: CommandResultSchema.parse({ state: "rejected", commandId: COMMAND, code: "bulk-child-errored", message: "private" }), feedback: fb("COMMAND_REFUSED") } },
  { name: "refused kind over an errored bulk child", outcome: { kind: "refused", commandId: id(14), reply: BulkRunCommandOutcomeSchema.parse({ outcome: "errored", runId: id(1), commandId: id(14), detail: "private" }), feedback: fb("COMMAND_REFUSED") } },
];

const applied = CommandResultSchema.parse({ state: "applied", commandId: COMMAND, affectedTargets: [{ family: "run", runId: id(1) }] });
/** Landed, then readback showed the target had moved on: the state still follows the outcome kind, as before. */
const SUPERSEDED: readonly { readonly kind: "conflict" | "refused" | "failed"; readonly settings: "conflict" | "refused"; readonly review: "conflict" | "refused" }[] = [
  { kind: "conflict", settings: "conflict", review: "conflict" },
  { kind: "refused", settings: "refused", review: "refused" },
  { kind: "failed", settings: "refused", review: "refused" },
];
const superseded = (kind: "conflict" | "refused" | "failed"): CommandOutcome =>
  ({ kind, commandId: COMMAND, reply: applied, readback: {}, feedback: fb("COMMAND_CONFLICT") });

describe("every mounted surface shows an unknown outcome as unknown", () => {
  for (const { name, outcome } of UNKNOWN) {
    it(`Settings save state: ${name}`, () => {
      assert.equal(commandSaveState(outcome).state, "unconfirmed");
    });
  }
  for (const { name, outcome } of UNKNOWN) {
    it(`OCR review attempt state: ${name}`, () => {
      assert.equal(reviewAttemptState(outcome), "uncertain");
    });
  }

  const request = CommandRequestSchema.parse({ commandId: COMMAND, requestedAt: "2026-08-03T12:00:00.000Z", requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "cancel", target: { runId: id(1), expectedVersion: 1 } });
  const client: SharedCommands = {
    executeCommand: () => Promise.reject(new Error("fixture-client-unused")),
    executeBulkCommand: () => Promise.reject(new Error("fixture-client-unused")),
  };
  const scope: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  for (const { name, outcome } of UNKNOWN) {
    // The retained-attempt lookups of Settings, Credentials, Intake, Inbox, Sessions and the app all read this.
    it(`retained attempt lookups hold a settled attempt as unresolved: ${name}`, () => {
      const attempt: RetainedCommandAttempt = { request, body: JSON.stringify(request), scope, state: "settled", outcome };
      assert.equal(attemptUnresolved(attempt), true);
    });
  }
});

describe("a landed command shown after its target moved on keeps its outcome-kind state", () => {
  for (const { kind, settings, review } of SUPERSEDED) {
    it(`superseded ${kind}`, () => {
      assert.equal(commandSaveState(superseded(kind)).state, settings);
      assert.equal(reviewAttemptState(superseded(kind)), review);
    });
  }
});
