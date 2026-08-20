/**
 * D253 — `settleCommandResult`, the one fold every command-issuing surface
 * reads a result through.
 *
 * Every arm of `CommandResultSchema` is pinned, and each result is parsed
 * THROUGH the schema first: a fold tested against hand-built objects is a fold
 * tested against a shape the wire may not produce.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { settleCommandResult } from "../../../src/dashboard/app/command-result.js";

const COMMAND_ID = "0f3b6d5a-2e5a-4b8f-9a4e-1c2d3e4f5a6b";
const RUN_ID = "8a1c9d2e-3f4b-4c5d-8e9f-0a1b2c3d4e5f";

const settle = (raw: unknown) => settleCommandResult(CommandResultSchema.parse(raw));

describe("settleCommandResult (D253)", () => {
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
    const settlement = settle({
      state: "conflict",
      commandId: COMMAND_ID,
      currentVersion: 7,
      message: "the run moved while this was open.",
    });
    assert.equal(settlement.kind, "refused");
    if (settlement.kind !== "refused") return;
    assert.equal(settlement.reason, "conflict");
    // The server's sentence survives, and the number that resolves it is added.
    assert.match(settlement.problem, /the run moved while this was open\./u);
    assert.match(settlement.problem, /version 7/u);
    // Never "try again": a re-send carries the same stale expectedVersion.
    assert.doesNotMatch(settlement.problem, /try again/iu);
  });

  it("passes a kernel rejection's own sentence through UNCHANGED", () => {
    const settlement = settle({
      state: "rejected",
      commandId: COMMAND_ID,
      code: "invalid-state",
      message: "run is terminal; corrections apply only to a resumable run",
    });
    assert.deepEqual(settlement, {
      kind: "refused",
      reason: "rejected",
      problem: "run is terminal; corrections apply only to a resumable run",
    });
  });

  it("keeps the two refusals distinguishable — they are different operator acts", () => {
    const conflict = settle({ state: "conflict", commandId: COMMAND_ID, currentVersion: 2, message: "moved." });
    const rejected = settle({ state: "rejected", commandId: COMMAND_ID, code: "policy-refused", message: "moved." });
    assert.notDeepEqual(conflict, rejected);
  });
});
