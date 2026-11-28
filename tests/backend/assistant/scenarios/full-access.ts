import assert from "node:assert/strict";
import type { AssistantScenario } from "../../../support/helpers/assistant-scenario.js";

const dryRun = "Start a separations dry run for 4502.";
const entries = ["4502"];
const start = { tool: "start_session", args: { workflow: "separations", entries } };
const propose = (dryRun: boolean) => ({ tool: "propose_workflow_start", args: { workflow: "separations", entries, dryRun } });
const refused: AssistantScenario["turns"][number]["check"] = ({ envelope }) => {
  assert.ok(envelope.kind === "result" && envelope.result.state === "no-reply");
  assert.equal(envelope.result.reason, "ASSISTANT_PROPOSAL_REFUSED");
  assert.equal(envelope.result.canRetry, false);
};
const proposed: AssistantScenario["turns"][number]["check"] = ({ envelope }) => {
  assert.ok(envelope.kind === "result" && envelope.result.state === "answered");
  assert.ok(envelope.result.reply.parts.some(part => part.kind === "bullets"));
  assert.ok(envelope.result.reply.parts.every(part => part.kind !== "session"));
};

export const fullAccess: AssistantScenario = {
  name: "Stored Full access starts only supported dry runs while enabled",
  budget: { largestRequest: 1763, total: 15591 },
  turns: [{
    message: dryRun,
    approvalMode: "full-access",
    provider: [start, "The session was refused."],
    check(observation) {
      refused(observation);
      assert.equal(observation.sessionStarts + observation.proposalStarts, 0);
    },
  }, {
    message: dryRun,
    fullAccess: true,
    approvalMode: "full-access",
    provider: [start, "The dry run started."],
    check({ envelope, requests, proposalStarts, sessionStarts, sessionClaim }) {
      assert.ok(envelope.kind === "result" && envelope.result.state === "answered");
      const part = envelope.result.reply.parts.at(-1);
      assert.ok(part?.kind === "session");
      assert.equal(sessionStarts, 1);
      assert.equal(proposalStarts, 0);
      assert.equal(sessionClaim?.claim.approvalMode, "full-access");
      assert.equal(sessionClaim.claim.dryRun, true);
      assert.deepEqual(sessionClaim.outcome, { state: "started", runIds: [part.runId] });
      assert.ok(requests.every(request => !JSON.stringify(request).includes('"approvalMode"')));
    },
  }, {
    message: dryRun,
    approvalMode: "ask",
    provider: [propose(true), "The dry run is ready for review."],
    check(observation) {
      proposed(observation);
      assert.equal(observation.sessionStarts, 1);
      assert.equal(observation.proposalStarts, 0);
    },
  }, {
    message: "Start separations for 4502 and file the result.",
    approvalMode: "full-access",
    provider: [propose(false), "The run is ready for review."],
    check(observation) {
      proposed(observation);
      assert.equal(observation.sessionStarts, 1);
      assert.equal(observation.proposalStarts, 0);
    },
  }, {
    message: "yes",
    approvalMode: "full-access",
    provider: [],
    check({ envelope, sessionStarts, proposalStarts }) {
      assert.ok(envelope.kind === "result" && envelope.result.state === "answered");
      assert.deepEqual(envelope.result.reply.parts.map(part => part.kind), ["answered", "session"]);
      assert.equal(sessionStarts, 1);
      assert.equal(proposalStarts, 1);
    },
  }, {
    message: dryRun,
    approvalMode: "full-access",
    revokeAtEffect: true,
    provider: [start, "The session was refused."],
    check(observation) {
      refused(observation);
      assert.equal(observation.sessionStarts, 1);
      assert.equal(observation.proposalStarts, 1);
    },
  }],
};
