import { Hono } from "hono";
import { registerCommandsRoutes } from "../../../../src/backend/transports/http/routes/commands.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { publicWriteCommand, publicWriteTarget, resolveWriteCommandTarget } from "../../../../src/backend/runs/commands/write-command-target.js";
import { CommandRefusal } from "../../../../src/backend/runs/commands/command-refusal.js";
import { NOW, UUID_1, UUID_2, UUID_4, UUID_5, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const intent = WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING, status: "parked", parkedCode: "unknown", message: "Fixture unknown",
  authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "Fixture unknown") });
if (intent.status !== "parked") throw new Error("fixture is not parked");
const native = CommandRequestSchema.parse({ commandId: UUID_5, requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
  family: "run", type: "recheck-write", target: { runId: intent.runId, expectedVersion: 4, writeIntentId: intent.writeIntentId,
    intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest },
  payload: { occurrenceKeyDigest: intent.idempotencyKeyDigest } });

it("issues an opaque occurrence token independent of the natural business key", () => {
  const target = { writeIntentId: UUID_1, intentGeneration: 1, writeAttemptId: UUID_4, occurrenceKeyDigest: "a".repeat(64) };
  const first = publicWriteTarget(target);
  assert.notEqual(first.occurrenceKeyDigest, target.occurrenceKeyDigest);
  assert.equal(publicWriteTarget({ ...target, occurrenceKeyDigest: "b".repeat(64) }).occurrenceKeyDigest, first.occurrenceKeyDigest);
  assert.notEqual(publicWriteTarget({ ...target, writeIntentId: UUID_2 }).occurrenceKeyDigest, first.occurrenceKeyDigest);
  assert.notEqual(publicWriteTarget({ ...target, intentGeneration: 2 }).occurrenceKeyDigest, first.occurrenceKeyDigest);
});

it("resolves served commands only through exact server-side intent authority", () => {
  const served = publicWriteCommand(native);
  assert.ok(!JSON.stringify(served).includes(intent.idempotencyKeyDigest));
  const repositories = { commands: { get: () => undefined }, writeIntents: { get: () => intent } };
  assert.deepEqual(resolveWriteCommandTarget(served, repositories), native);
  assert.throws(() => resolveWriteCommandTarget(native, repositories), CommandRefusal);
  assert.throws(() => resolveWriteCommandTarget(served, { ...repositories, writeIntents: { get: () => undefined } }), CommandRefusal);
  assert.throws(() => resolveWriteCommandTarget(served, { ...repositories, writeIntents: { get: () => WriteIntentRecordSchema.parse({ ...intent, generation: 2 }) } }), CommandRefusal);
});

it("replays an exact retained command after the live intent is gone and rejects changed bindings", () => {
  const repositories = { commands: { get: () => native }, writeIntents: { get: () => undefined } };
  assert.deepEqual(resolveWriteCommandTarget(publicWriteCommand(native), repositories), native);
  const changed = CommandRequestSchema.parse({ ...publicWriteCommand(native), target: { ...native.target, expectedVersion: 5 } });
  assert.throws(() => resolveWriteCommandTarget(changed, repositories), CommandRefusal);
});

it("resolves a wire token at HTTP ingress and refuses a private digest before kernel dispatch", async () => {
  const app: DashboardApp = new Hono();
  app.use("*", async (c, next) => { c.set("requestActorId", LOCAL_OPERATOR_ACTOR_ID); await next(); });
  const received: unknown[] = [];
  const repositories = { commands: { get: () => undefined }, writeIntents: { get: () => intent } };
  const forbidden = (): never => { throw new Error("unrelated effect"); };
  registerCommandsRoutes(app, { clock: manualClock(new Date(NOW)), commandJournal: repositories.commands,
    resolveWriteCommand: request => resolveWriteCommandTarget(request, repositories), protectedCommandAcceptedAt: () => undefined,
    bulkCommandAcceptances: { withTransaction: forbidden }, intake: { prepare: async () => undefined }, resolveIdentityGateAnswer: forbidden, resolveGateArmAnswer: forbidden,
    commands: { execute: forbidden, executeBulk: forbidden, submit: async request => {
      received.push(request); return CommandResultSchema.parse({ state: "rejected", commandId: UUID_5, code: "invalid-state", message: "Fixture no execution" });
    } },
  });
  const send = (request: unknown) => app.request("http://localhost/api/v1/commands", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  assert.equal((await send(publicWriteCommand(native))).status, 422);
  assert.deepEqual(received, [native]);
  assert.equal((await send(native)).status, 422);
  assert.equal(received.length, 1);
});
