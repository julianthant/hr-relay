import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { settleCommandResult } from "../../../../../src/dashboard/app/commands/command-result.js";
import { commandResultDetail, commandResultFeedEntry, commandResultTitle } from "../../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";

const RUN = "1a000000-0000-4000-8000-000000000001";
const COMMAND = "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b";
const refused = (code: string, message: string) => {
  const entry = commandResultFeedEntry({ settlement: settleCommandResult(CommandResultSchema.parse({ state: "rejected", commandId: COMMAND, code, message })),
    targetRunId: RUN, expectedVersion: 3, commandId: COMMAND, subject: "Morrow, Bea", workflowLabel: "Separations", actionLabel: "Cancel run", clock: "9:41 AM", actorId: "actor-1" });
  assert.ok(entry);
  return { title: commandResultTitle(entry), detail: commandResultDetail(entry) };
};

describe("a refused Cancel run names its own operator-safe reason", () => {
  it("a terminal run", () => {
    const { title, detail } = refused("invalid-state", `run ${RUN} is already terminal; there is nothing to cancel`);
    assert.equal(title, "Couldn't cancel: the run already finished or changed.");
    assert.equal(detail, "Morrow, Bea · the run already finished or changed");
  });
  it("an unresolved fenced write", () => {
    const { title, detail } = refused("invalid-state", `run ${RUN} holds ucpath write intent wi-1 at generation 2, which is attempting: a real HR transaction was fenced and nobody has said whether it landed.`);
    assert.equal(title, "Couldn't cancel: a write is still unresolved; record whether it landed first.");
    assert.equal(detail, "Morrow, Bea · a write is still unresolved; record whether it landed first");
  });
  it("a catalog-backed code keeps its catalog reason", () => {
    const { title } = refused("RUN_CONTINUATION_REFUSED", "internal");
    assert.equal(title, "Couldn't cancel: saved steps could not be verified for recovery, so none were reused.");
  });
  it("never shows a run id or the server sentence", () => {
    for (const code of ["invalid-state", "policy-refused", "target-not-found"]) {
      const { title, detail } = refused(code, `run ${RUN} internal sentence`);
      assert.ok(!`${title}${detail}`.includes(RUN) && !`${title}${detail}`.includes("internal sentence"));
    }
  });
});
