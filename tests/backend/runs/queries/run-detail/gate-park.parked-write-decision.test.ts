import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ActionDescriptorWireSchema } from "../../../../../src/models/dashboard/actions.js";
import { parkedWriteDecision } from "../../../../../src/backend/runs/queries/run-detail/gate-park.js";

const writeTarget = { writeIntentId: "11111111-1111-4111-8111-111111111111", intentGeneration: 1, writeAttemptId: "22222222-2222-4222-8222-222222222222",
  bindingProofDigest: "a".repeat(64), occurrenceKeyDigest: "b".repeat(64) };
const confirmOf = (key: string) => ({ title: `${key} title`, confirmLabel: key, tone: "neutral" as const });
const action = (key: string, command: string) => ActionDescriptorWireSchema.parse({ key, label: key, intent: "neutral", placement: ["footer"], kind: "command", command, expectedVersion: 3, writeTarget, confirm: confirmOf(key) });
const RECHECK = action("recheck-write", "recheck-write"), ABSENT = action("resolve-write-absent", "resolve-write-absent");

describe("parkedWriteDecision", () => {
  it("serves Check again and Check result when a transaction id is accepted, with no separate It didn't land", () => {
    const decision = parkedWriteDecision("ambiguous", true, [RECHECK, ABSENT]);
    assert.equal(decision.type, "write-parked");
    assert.deepEqual(decision.options.map(({ id, recommended }) => [id, recommended]), [["check-again", undefined], ["check-result", true]]);
    assert.deepEqual(decision.options[1]?.send, { via: "verification", presentActionKey: "recheck-write", absentActionKey: "resolve-write-absent", transactionPattern: "^T\\d+$" });
    assert.deepEqual(decision.options[1]?.input, { kind: "verification", question: "Was it submitted?" });
    assert.equal(decision.options[0]?.input, undefined, "Check again stays submittable without an answer");
    assert.deepEqual(decision.options[0]?.confirm, confirmOf("recheck-write"));
    assert.equal(decision.options[1]?.confirm, undefined, "Check result's two outcomes keep the confirms on their own actions");
  });

  it("serves It didn't land and recommends Check again when no transaction id is accepted", () => {
    const decision = parkedWriteDecision("unknown", false, [RECHECK, ABSENT]);
    assert.equal(decision.type, "write-unknown");
    assert.deepEqual(decision.options.map(({ id, recommended }) => [id, recommended]), [["check-again", true], ["didnt-land", undefined]]);
    assert.ok(decision.options.every(({ id }) => id !== "retry"));
    assert.deepEqual(decision.options.map(({ confirm }) => confirm), [confirmOf("recheck-write"), confirmOf("resolve-write-absent")]);
  });

  it("sends Check again through the held UCPath check when one is served", () => {
    const held = { ...RECHECK, key: "check-parked-write", command: "check-parked-write" as const, confirm: confirmOf("check-parked-write") };
    const decision = parkedWriteDecision("unknown", false, [RECHECK, ABSENT, held]);
    assert.deepEqual(decision.options[0]?.send, { via: "action", actionKey: "check-parked-write" });
    assert.deepEqual(decision.options[0]?.confirm, confirmOf("check-parked-write"));
  });
});
