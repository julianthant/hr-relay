import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composeCommandRequest, verifyShellCommandEffect } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { parkedWriteLogActions } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { ParkedWriteDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { FIXTURE_PARKED_WRITE } from "../../../support/fixtures/dashboard/run-detail/gates-park.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";

const parked = ParkedWriteDetailWireSchema.parse(FIXTURE_PARKED_WRITE);
const context = { actorId: "local-operator", source: "run-detail", parkedWrite: parked } as const;
const target = { runId: parked.runId, expectedVersion: 6 };
function descriptor(verb: "recheck-write" | "resolve-write-absent") {
  const action = parked.actions.find(action => action.kind === "command" && action.command === verb);
  assert.ok(action?.kind === "command"); return action;
}

describe("parked-write command composition and projection", () => {
  for (const acceptsTransactionId of [false, true]) it(`projects served choices with acceptsTransactionId=${acceptsTransactionId}`, () => {
    const actions = parkedWriteLogActions({ ...parked, acceptsTransactionId });
    assert.deepEqual(actions.map(action => [action.label, action.input?.kind]), acceptsTransactionId
      ? [["Check again", undefined], ["Check result", "verification"]]
      : [["Check again", undefined], ["It didn't land", undefined]]);
    assert.deepEqual(parkedWriteLogActions({ ...parked, actions: [] }), []);
  });
  for (const [verb, transactionId] of [["recheck-write", undefined], ["recheck-write", " T123456 "], ["resolve-write-absent", undefined]] as const) {
    it(`composes ${verb} with transactionId=${transactionId}`, () => {
      const action = descriptor(verb);
      const composed = composeCommandRequest(action, target, { ...context, transactionId });
      assert.equal(composed.state, "ready"); if (composed.state !== "ready") return;
      const request = CommandRequestSchema.parse(composed.request);
      assert.equal(request.family, "run"); assert.equal(request.type, verb);
      const { occurrenceKeyDigest, ...writeTarget } = action.writeTarget!;
      assert.deepEqual(request.target, { ...target, ...writeTarget });
      assert.deepEqual("payload" in request && request.payload, { occurrenceKeyDigest, ...(transactionId === undefined ? {} : { transactionId: "T123456" }) });
    });
  }
  it("refuses stale version, generation, intent, attempt, binding and occurrence identities", () => {
    const action = descriptor("recheck-write"); assert.ok(action.writeTarget);
    for (const field of ["writeIntentId", "intentGeneration", "writeAttemptId", "bindingProofDigest", "occurrenceKeyDigest"] as const) {
      const value = field === "intentGeneration" ? 99 : field.endsWith("Digest") ? "f".repeat(64) : "90000000-0000-4000-8000-000000000001";
      const composed = composeCommandRequest({ ...action, writeTarget: { ...action.writeTarget, [field]: value } }, target, context);
      assert.equal(composed.state, "refused", field);
    }
    assert.equal(composeCommandRequest(action, { ...target, expectedVersion: 7 }, context).state, "refused");
    assert.equal(composeCommandRequest(action, { ...target, runId: "another-run" }, context).state, "refused");
    assert.equal(composeCommandRequest(action, target, { ...context, parkedWrite: { ...parked, generation: 2 } }).state, "refused");
  });
  it("refuses unsupported or malformed transaction numbers and missing authority", () => {
    const action = descriptor("recheck-write");
    for (const transactionId of ["", "123456", "T12x", " "]) assert.equal(composeCommandRequest(action, target, { ...context, transactionId }).state, "refused");
    assert.equal(composeCommandRequest(action, target, { ...context, transactionId: "T123456", parkedWrite: { ...parked, acceptsTransactionId: false } }).state, "refused");
    assert.equal(composeCommandRequest(descriptor("resolve-write-absent"), target, { ...context, transactionId: "T123456" }).state, "refused");
    assert.equal(composeCommandRequest(action, target, { actorId: context.actorId, source: context.source }).state, "refused");
    assert.equal(ParkedWriteDetailWireSchema.safeParse({ ...parked, acceptsTransactionId: undefined }).success, false);
  });
  it("settles only an exact acknowledged run with advanced version", async () => {
    const composed = composeCommandRequest(descriptor("recheck-write"), target, context); assert.ok(composed.state === "ready");
    const request = CommandRequestSchema.parse(composed.request);
    const reply = CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "run", runId: parked.runId }] });
    for (const [runId, rowRevision, expected] of [[parked.runId, 6, "mismatch"], [parked.runId, 7, "matched"], ["other", 7, "mismatch"]] as const) {
      const client = { runDetail: async () => ({ runId, rowRevision }) } as unknown as DashboardClient;
      assert.equal((await verifyShellCommandEffect(client, "2026-08-03", request, reply)).state, expected);
    }
  });
});
