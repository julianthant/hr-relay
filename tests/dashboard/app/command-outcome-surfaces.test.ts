import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commandSaveState } from "../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import type { CommandOutcome } from "../../../src/dashboard/app/commands/command-executor.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from "../../../src/models/failures/error-catalog.js";
import { BulkRunCommandOutcomeSchema, CommandResultSchema } from "../../../src/rules/commands/commands.js";

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

describe("every mounted surface shows an unknown outcome as unknown", () => {
  for (const { name, outcome } of UNKNOWN) {
    it(`Settings save state: ${name}`, () => {
      assert.equal(commandSaveState(outcome).state, "unconfirmed");
    });
  }
});
