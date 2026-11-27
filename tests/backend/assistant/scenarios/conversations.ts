import assert from "node:assert/strict";
import type { AssistantM1RespondEnvelope } from "../../../../src/models/dashboard/assistant.js";
import { SCENARIO_PERSON, type AssistantScenario } from "../../../support/helpers/assistant-scenario.js";

function answered(envelope: AssistantM1RespondEnvelope) {
  assert.ok(envelope.kind === "result" && envelope.result.state === "answered");
  return envelope.result.reply;
}

const employee = "[[E1.g1]]";
const person = "[[P1.g1]]";

// Each budget is the measured request size plus 10%, rounded up.
export const personLookup: AssistantScenario = {
  name: "Person lookup from reads",
  budget: { largestRequest: 1383, total: 4040 },
  turns: [{
    message: `Who matches ${SCENARIO_PERSON.eid}?`,
    provider: [{ tool: "read_person", args: { query: employee } }, `The matching person is ${person}.`],
    check({ envelope, requests, proposalStarts, sessionStarts }) {
      const { parts } = answered(envelope);
      // The dashboard composition binds references by value.
      assert.ok(parts.some(part => part.kind === "text" && part.runs.some(run => run.kind === "value" && run.value === SCENARIO_PERSON.name)));
      const result = requests[1]?.input.at(-1);
      assert.ok(result && "type" in result && result.type === "function_call_output");
      assert.deepEqual(JSON.parse(result.output), { person });
      assert.equal(proposalStarts + sessionStarts, 0);
    },
  }, {
    message: "Thanks — where did the match come from?",
    provider: ["It came from the person lookup."],
    check({ envelope, requests }) {
      answered(envelope);
      assert.ok(JSON.stringify(requests[0]?.input).includes(`The matching person is ${person}.`));
    },
  }],
};

const proposeStart: AssistantScenario["turns"][number] = {
  message: `Prepare a Lookup for ${SCENARIO_PERSON.eid}.`,
  provider: [{ tool: "propose_workflow_start", args: { workflow: "person-lookup", entries: [employee], dryRun: false } }, "Lookup is ready for review."],
  check({ envelope, requests, proposalStarts, sessionStarts }) {
    assert.ok(answered(envelope).parts.some(part => part.kind === "bullets" && part.items.length === 1));
    const result = requests[1]?.input.at(-1);
    assert.ok(result && "type" in result && result.type === "function_call_output");
    assert.deepEqual(JSON.parse(result.output), { status: "awaiting-yes", count: 1 });
    assert.equal(proposalStarts + sessionStarts, 0);
  },
};

export const scenarios: readonly AssistantScenario[] = [personLookup, {
  name: "Workflow start approved by typed yes",
  budget: { largestRequest: 1410, total: 2712 },
  turns: [proposeStart, {
    message: "yes",
    provider: [],
    check({ envelope, proposalStarts, sessionStarts }) {
      const reply = answered(envelope);
      assert.deepEqual(reply.parts.map(part => part.kind), ["answered", "session"]);
      assert.equal(reply.usage.callCount, 0);
      assert.equal(proposalStarts, 1);
      assert.equal(sessionStarts, 0);
    },
  }],
}, {
  name: "Workflow start refused after plan changes",
  budget: { largestRequest: 1410, total: 2712 },
  turns: [proposeStart, {
    message: "yes",
    changePlan: true,
    provider: [],
    check({ envelope, proposalStarts, sessionStarts }) {
      const reply = answered(envelope);
      assert.ok(reply.parts.some(part => part.kind === "text" && part.runs.some(run => run.kind === "failure" && run.code === "ASSISTANT_PROPOSAL_CHANGED")));
      assert.ok(reply.parts.every(part => part.kind !== "session"));
      assert.equal(reply.usage.callCount, 0);
      assert.equal(proposalStarts + sessionStarts, 0);
    },
  }],
}, {
  name: "Read refusal",
  budget: { largestRequest: 1406, total: 2708 },
  turns: [{
    message: "Look up the missing person.",
    provider: [{ tool: "read_person", args: { query: "missing" } }, "No person is available."],
    check({ envelope, proposalStarts, sessionStarts }) {
      assert.ok(envelope.kind === "result" && envelope.result.state === "no-reply");
      assert.equal(envelope.result.reason, "ASSISTANT_READ_UNAVAILABLE");
      assert.equal(envelope.result.canRetry, true);
      assert.equal(proposalStarts + sessionStarts, 0);
    },
  }],
}, {
  name: "Read-only session start",
  budget: { largestRequest: 1399, total: 2703 },
  turns: [{
    message: `Start a read-only Lookup for ${SCENARIO_PERSON.eid}.`,
    provider: [{ tool: "start_session", args: { workflow: "person-lookup", entries: [employee] } }, "Lookup started."],
    check({ envelope, requests, proposalStarts, sessionStarts, sessionClaim }) {
      const part = answered(envelope).parts.at(-1);
      assert.ok(part?.kind === "session");
      assert.equal(part.meta, "queued");
      assert.equal(sessionStarts, 1);
      assert.equal(proposalStarts, 0);
      assert.equal(sessionClaim?.claim.approvalMode, "ask");
      assert.equal(sessionClaim.claim.dryRun, false);
      assert.deepEqual(sessionClaim.outcome, { state: "started", runIds: [part.runId] });
      const result = requests[1]?.input.at(-1);
      assert.ok(result && "type" in result && result.type === "function_call_output");
      assert.deepEqual(JSON.parse(result.output), { runs: ["[[R1.g1]]"] });
    },
  }],
}, {
  name: "No reply after provider disconnects",
  budget: { largestRequest: 1300, total: 1300 },
  turns: [{
    message: "What can Lookup do?",
    provider: [null],
    check({ envelope, proposalStarts, sessionStarts }) {
      assert.ok(envelope.kind === "delivery");
      assert.equal(envelope.receipt.delivery, "delivery-unknown");
      assert.equal(envelope.usage.state, "unavailable");
      assert.equal(envelope.usage.callCount, 1);
      assert.equal(proposalStarts + sessionStarts, 0);
    },
  }],
}];
