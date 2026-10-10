
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CommandRejectionCodeSchema, CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { commandFailureToast, settleCommandResult } from "../../../../../src/dashboard/app/commands/command-result.js";

const COMMAND_ID = "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b";
const RUN_ID = "8a1c9d2e-3f4b-4c5d-8e9f-0a1b2c3d4e5f";

const settle = (raw: unknown) => settleCommandResult(CommandResultSchema.parse(raw));

const CONFLICT_MESSAGE = "the run moved while this was open.";
const REJECTED_MESSAGE = "run is terminal; corrections apply only to a resumable run";

const conflictOf = (currentVersion: number, message = CONFLICT_MESSAGE) =>
  settle({ state: "conflict", commandId: COMMAND_ID, currentVersion, message });

const rejectedOf = (code: string, message = REJECTED_MESSAGE) =>
  settle({ state: "rejected", commandId: COMMAND_ID, code, message });

describe("settleCommandResult", () => {
  it("settles both landing arms as applied, and says which was a replay", () => {
    const targets = [{ family: "run", runId: RUN_ID }];
    assert.deepEqual(
      settle({ state: "applied", commandId: COMMAND_ID, affectedTargets: targets }),
      { kind: "applied", replayed: false },
    );
    assert.deepEqual(
      settle({ state: "already-applied", commandId: COMMAND_ID, affectedTargets: targets }),
      { kind: "applied", replayed: true },
    );
  });

  it("settles a CAS conflict as a REFUSAL carrying the server's own version", () => {
    const settlement = conflictOf(7);
    assert.equal(settlement.kind, "refused");
    if (settlement.kind !== "refused") return;
    assert.equal(settlement.reason, "conflict");
    // The server's sentence survives, and the number that resolves it is added.
    assert.match(settlement.problem, /the run moved while this was open\./u);
    assert.match(settlement.problem, /version 7/u);
    // Never "try again": a re-send carries the same stale expectedVersion.
    assert.doesNotMatch(settlement.problem, /try again/iu);
  });

  it("carries a conflict's `currentVersion` as a NUMBER, for a surface that lays it out itself", () => {
    const settlement = conflictOf(41);
    assert.equal(settlement.kind === "refused" && settlement.reason === "conflict"
      ? settlement.currentVersion
      : undefined, 41);
  });

  it("keeps a conflict's `message` UNCOMPOSED — it is the wire's sentence, not the fold's", () => {
    // Keep the visible refusal string exact; it is part of the frozen accessibility corpus.
    const settlement = conflictOf(2);
    if (settlement.kind !== "refused" || settlement.reason !== "conflict") {
      assert.fail("a conflict must settle as a conflict refusal");
      return;
    }
    assert.equal(settlement.message, CONFLICT_MESSAGE);
    // And the composed sentence is genuinely a DIFFERENT string, so a caller
    // that wants the version gets it by asking for `problem`, never by accident.
    assert.notEqual(settlement.problem, settlement.message);
  });

  it("passes a kernel rejection's own sentence through UNCHANGED", () => {
    assert.deepEqual(rejectedOf("invalid-state"), {
      kind: "refused",
      reason: "rejected",
      problem: REJECTED_MESSAGE,

      message: REJECTED_MESSAGE,
      code: "invalid-state",
    });
  });

  it("carries EVERY rejection code the kernel can send, verbatim", () => {

    for (const code of CommandRejectionCodeSchema.options) {
      const settlement = rejectedOf(code);
      assert.equal(
        settlement.kind === "refused" && settlement.reason === "rejected" ? settlement.code : undefined,
        code,
        `the fold must carry the ${code} rejection code`,
      );
    }
  });

  it("keeps the two refusals distinguishable — they are different operator acts", () => {
    const conflict = conflictOf(2, "moved.");
    const rejected = rejectedOf("policy-refused", "moved.");
    assert.notDeepEqual(conflict, rejected);
    // Even on the SAME server sentence, the two are told apart by `reason`
    // alone — a surface never has to compare strings to know which it holds.
    assert.equal(conflict.kind === "refused" ? conflict.reason : undefined, "conflict");
    assert.equal(rejected.kind === "refused" ? rejected.reason : undefined, "rejected");
  });

  it("answers `refused` for BOTH refusal arms and `applied` for neither", () => {

    assert.deepEqual(
      [
        settle({ state: "applied", commandId: COMMAND_ID, affectedTargets: [{ family: "run", runId: RUN_ID }] }).kind,
        settle({
          state: "already-applied",
          commandId: COMMAND_ID,
          affectedTargets: [{ family: "run", runId: RUN_ID }],
        }).kind,
        conflictOf(3).kind,
        rejectedOf("target-not-found").kind,
      ],
      ["applied", "applied", "refused", "refused"],
    );
  });
});

// Before dispatch the client can prove nothing was sent; after dispatch it must preserve uncertainty.
describe("commandFailureToast — where the command died decides what may be claimed", () => {
  it("says nothing was SENT before dispatch, carrying the client's own reason verbatim", () => {
    const toast = commandFailureToast({ stage: "before-dispatch", reason: "a rename needs a name." });
    assert.equal(toast.tone, "danger");
    assert.equal(toast.title, "Nothing was sent");
    assert.equal(toast.description, "a rename needs a name.");
  });

  it("refuses to claim anything about the server after dispatch, and says what to do instead", () => {
    const toast = commandFailureToast({ stage: "after-dispatch", caught: new Error("network error") });
    assert.equal(toast.tone, "danger");
    assert.equal(toast.title, "Result unknown — check the run");
    assert.ok(
      !/nothing was (recorded|sent)/iu.test(`${toast.title} ${toast.description}`),
      `a throw after dispatch cannot know either negative: ${toast.title} — ${toast.description}`,
    );
    assert.ok(toast.description.includes("network error"), "the throw's own sentence survives");
    assert.ok(
      toast.description.includes("open the run"),
      "an unknown result is only actionable if the toast names the one thing that resolves it",
    );
    assert.ok(toast.description.includes("check its logs"), "unknown results point to the current inspection surface");
    assert.ok(!toast.description.includes("receipt"), "the retired tab cannot be a recovery destination");
  });

  it("keeps the two stages DISTINGUISHABLE, which is the whole finding", () => {
    const before = commandFailureToast({ stage: "before-dispatch", reason: "a rename needs a name." });
    const after = commandFailureToast({ stage: "after-dispatch", caught: new Error("network error") });
    assert.notEqual(before.title, after.title);
  });

  it("survives a throw that is not an Error, rather than printing `[object Object]` at the operator", () => {
    const toast = commandFailureToast({ stage: "after-dispatch", caught: "socket hang up" });
    assert.ok(toast.description.startsWith("socket hang up "), toast.description);
  });
});
