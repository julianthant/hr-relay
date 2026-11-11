import { describe, expect, it } from "vitest";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";
import { CommandRequestSchema, CommandResultSchema, type CommandRequest, type GateArmAnswerRequest, type IdentityGateAnswerRequest } from "../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const GATE_REF = "00000000-0000-4000-8000-0000000000a1";
const OPTION_REF = "00000000-0000-4000-8000-0000000000b0";
const envelope = { commandId: "00000000-0000-4000-8000-0000000000c1", requestedAt: "2026-11-10T09:00:00.000Z", requestedBy: "local-operator", source: "dashboard" };
const target = { runId: RUN_ID, gateId: "identity-approval", expectedVersion: 3 };

type Resolution = ReturnType<Parameters<typeof createOperatorCommandIngress>[0]["resolveIdentityGateAnswer"]>;
function ingress(resolve: (answer: IdentityGateAnswerRequest, journaled: CommandRequest | undefined) => Resolution,
  resolveArm: (answer: GateArmAnswerRequest, journaled: CommandRequest | undefined) => Resolution = () => { throw new Error("no gate-arm answer here"); }) {
  return createOperatorCommandIngress({ clock: manualClock(new Date("2026-11-10T09:00:00.000Z")), journal: { get: () => undefined },
    protectedCommandAcceptedAt: () => undefined, bulkAcceptances: { withTransaction: () => { throw new Error("no bulk command here"); } },
    resolveIdentityGateAnswer: resolve, resolveGateArmAnswer: resolveArm });
}

describe("operator command ingress gate-arm answers", () => {
  it("hands the answer to the gate-arm resolver and executes the one resolve-gate it returns", async () => {
    const armTarget = { runId: RUN_ID, gateId: "hire-review", expectedVersion: 3 };
    const resolved = CommandRequestSchema.parse({ ...envelope, family: "gate", type: "resolve-gate", target: armTarget,
      payload: { result: { schemaHash: "a".repeat(64), value: { decision: "new-hire", ruledOut: [] } } } });
    const seen: GateArmAnswerRequest[] = [], executed: CommandRequest[] = [];
    await ingress(() => { throw new Error("not an identity answer"); }, answer => { seen.push(answer); return { state: "accepted", request: resolved }; })
      .submit({ ...envelope, family: "gate", type: "answer-gate-arm", target: armTarget, payload: { arm: "new-hire" } },
        accepted => { executed.push(accepted); return Promise.resolve(CommandResultSchema.parse({ state: "rejected", commandId: accepted.commandId, code: "invalid-state", message: "stop" })); });
    expect(seen.map(answer => answer.payload)).toEqual([{ arm: "new-hire" }]);
    expect(executed).toEqual([resolved]);
  });
});

describe("operator command ingress identity answers", () => {
  it.each([
    { decision: "approved", gateRef: GATE_REF, optionRef: OPTION_REF },
    { decision: "approved", gateRef: GATE_REF, typedEid: "10000001" },
    { decision: "rejected", gateRef: GATE_REF },
  ])("hands each answer shape to the resolver and executes the canonical command it returns: %o", async payload => {
    const resolved = CommandRequestSchema.parse({ ...envelope, family: "gate", type: "resolve-gate", target,
      payload: { result: { schemaHash: "a".repeat(64), value: { decision: "rejected", reason: "Rejected in Logs", evidenceDigest: "b".repeat(64) } } } });
    const seen: IdentityGateAnswerRequest[] = [];
    const executed: CommandRequest[] = [];
    const result = await ingress(answer => { seen.push(answer); return { state: "accepted", request: resolved }; })
      .submit({ ...envelope, family: "gate", type: "answer-identity-gate", target, payload },
        accepted => { executed.push(accepted); return Promise.resolve(CommandResultSchema.parse({ state: "rejected", commandId: accepted.commandId, code: "invalid-state", message: "stop" })); });
    expect(seen.map(answer => answer.payload)).toEqual([payload]);
    expect(executed.map(request => request.type)).toEqual(["resolve-gate"]);
    expect(result.state).toBe("rejected");
  });

  it("returns a refused answer without executing anything", async () => {
    const result = await ingress(() => ({ state: "refused", code: "invalid-state", message: "This identity review changed. Reload it before answering." }))
      .submit({ ...envelope, family: "gate", type: "answer-identity-gate", target, payload: { decision: "rejected", gateRef: GATE_REF } },
        () => { throw new Error("a refused answer must not execute"); });
    expect(result).toMatchObject({ state: "rejected", code: "invalid-state", message: "This identity review changed. Reload it before answering." });
  });
});
