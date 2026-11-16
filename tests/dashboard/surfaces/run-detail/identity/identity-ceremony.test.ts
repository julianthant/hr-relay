import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../../../support/helpers/dashboard/identity-ceremony-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";

import {
composeCommandRequest,
type CommandAction,
} from "../../../../../src/dashboard/app/commands/command-dispatch.js";
import {
identityCeremonyFor,
identityDraftProblem,
type IdentityGateAnswer,
type IdentityGateDetail,
} from "../../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";

import { DashboardCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";




const NOW = "2026-08-14T17:00:00.000Z";
/** The EID the document carries and the run checked. */
const CHECKED = "10833507";
/** The person a search on the document's NAME resolves — a different human. */
const NAME_SEARCH = "10203262";

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const UNSERVED_REF = "00000000-0000-4000-8000-0000000000ff";

const CONTEXT = { actorId: "local-operator", source: "run-detail" } as const;

const { ONE_CLICK, CHOOSE, NAME_MISMATCH, gateDetail } =
  createIdentityCeremonyFixtures(NOW, CHECKED, NAME_SEARCH, runId);




/** The three packets the three ceremonies fall out of. */

/** the name agrees, but a search on it resolves a DIFFERENT person */

/** Names that do not match. */




const APPROVE: CommandAction = identityApprovalAction("Approve");

function available(detail: IdentityGateDetail) {
  return { state: "available" as const, value: detail };
}

describe("identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1)", () => {
  it("derives the shape from the candidate count: one is a confirm, several are a pick", () => {
    assert.equal(gateDetail(ONE_CLICK).approvalShape, "one-click");
    assert.equal(ONE_CLICK.approvableEids.length, 1);
    // A name mismatch with two candidates is still a pick, never typed entry.
    for (const packet of [CHOOSE, NAME_MISMATCH]) {
      assert.equal(gateDetail(packet).approvalShape, "choose-a-candidate");
      assert.equal(packet.approvableEids.length, 2);
    }
    assert.equal(NAME_MISMATCH.approvalShape, "type-the-eid", "the stored risk shape is unchanged");
  });

  it("maps each shape to its own control", () => {
    assert.equal(identityCeremonyFor(gateDetail(ONE_CLICK)).kind, "confirm");
    assert.equal(identityCeremonyFor(gateDetail(CHOOSE)).kind, "choose");
    assert.equal(identityCeremonyFor(gateDetail(NAME_MISMATCH)).kind, "choose");
  });

  it("REFUSES an approvalShape this build has no control for — it never falls back to one click", () => {
    const forged = { ...gateDetail(CHOOSE), approvalShape: "type-the-eid" } as unknown as IdentityGateDetail;
    const ceremony = identityCeremonyFor(forged);
    assert.equal(ceremony.kind, "unsupported");
    assert.match(ceremony.kind === "unsupported" ? ceremony.reason : "", /type-the-eid/);
  });

  it("REFUSES a packet whose shape and candidate count contradict each other", () => {
    // The server states both facts. When they disagree only the server can say
    // which it meant, so this reports the contradiction rather than guessing.
    const oneClickTwoOptions = { ...gateDetail(CHOOSE), approvalShape: "one-click" } as IdentityGateDetail;
    const chooseOneOption = { ...gateDetail(ONE_CLICK), approvalShape: "choose-a-candidate" } as IdentityGateDetail;
    for (const [gate, diagnostic] of [
      [oneClickTwoOptions, /called this a one-click approval and served 2/u],
      [chooseOneOption, /asked for a candidate to be CHOSEN and served 1/u],
    ] as const) {
      const ceremony = identityCeremonyFor(gate);
      assert.equal(ceremony.kind, "unsupported");
      if (ceremony.kind !== "unsupported") continue;
      assert.match(ceremony.reason, diagnostic);
      assert.equal(identityDraftProblem(ceremony, { decision: "approved", optionRef: "" }), ceremony.reason);
    }
  });
});

describe("identityDraftProblem — only a served candidate can be sent", () => {
  it("refuses a ref the review never served and accepts a served one", () => {
    const detail = gateDetail(CHOOSE);
    const ceremony = identityCeremonyFor(detail);
    assert.match(identityDraftProblem(ceremony, { decision: "approved", optionRef: "" }) ?? "", /Pick which candidate/);
    assert.match(identityDraftProblem(ceremony, { decision: "approved", optionRef: UNSERVED_REF }) ?? "", /Pick which candidate/);
    assert.equal(identityDraftProblem(ceremony, { decision: "approved", optionRef: detail.options[1].ref }), undefined);
  });

  it("carries the unsupported reason through as the problem, so the send stays blocked", () => {
    const forged = { ...gateDetail(CHOOSE), approvalShape: "biometric-scan" } as unknown as IdentityGateDetail;
    assert.match(identityDraftProblem(identityCeremonyFor(forged), { decision: "approved", optionRef: forged.options[0].ref }) ?? "", /biometric-scan/);
  });
});

describe("composeCommandRequest — the ceremonies reach the identity-answer endpoint", () => {
  const COMMAND_CONTEXT = { ...CONTEXT, gateId: "identity-approval" } as const;
  const parsedGateAnswer = (composed: ReturnType<typeof composeCommandRequest>) => {
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") throw new Error("expected a ready command");
    const parsed = DashboardCommandRequestSchema.parse(composed.request);
    assert.equal(parsed.family, "gate");
    if (parsed.family !== "gate" || parsed.type !== "answer-identity-gate") throw new Error("expected answer-identity-gate");
    return parsed;
  };

  it("composes a CHOSEN candidate by the served gateRef and the picked option's ref, never an EID", () => {
    const detail = gateDetail(CHOOSE);
    const picked = detail.options[1];
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...COMMAND_CONTEXT, gate: available(detail), gateAnswer: { decision: "approved", optionRef: picked.ref } },
    );
    const parsed = parsedGateAnswer(composed);
    assert.deepEqual(parsed.target, { runId: detail.runId, gateId: "identity-approval", expectedVersion: 3 });
    assert.deepEqual(parsed.payload, { decision: "approved", gateRef: detail.gateRef, optionRef: picked.ref });
  });

  it("composes the one-click candidate from the served ref", () => {
    const detail = gateDetail(ONE_CLICK);
    const parsed = parsedGateAnswer(composeCommandRequest(APPROVE, { runId: runId(1), expectedVersion: 3 }, { ...COMMAND_CONTEXT, gate: available(detail) }));
    assert.deepEqual(parsed.payload, { decision: "approved", gateRef: detail.gateRef, optionRef: detail.options[0].ref });
  });

  it("never composes a typed Employee ID as an identity answer", () => {
    const detail = gateDetail(CHOOSE);
    for (const typedEid of ["10203262", CHECKED]) {
      const typed = { decision: "approved", typedEid } as unknown as IdentityGateAnswer;
      assert.equal(composeCommandRequest(APPROVE, { runId: runId(1), expectedVersion: 3 },
        { ...COMMAND_CONTEXT, gate: available(detail), gateAnswer: typed }).state, "refused");
    }
  });

  it("refuses a picked ref the review did not serve", () => {
    const composed = composeCommandRequest(
      APPROVE, { runId: runId(1), expectedVersion: 3 },
      { ...COMMAND_CONTEXT, gate: available(gateDetail(CHOOSE)), gateAnswer: { decision: "approved", optionRef: UNSERVED_REF } },
    );
    assert.equal(composed.state, "refused");
  });

  it("sends a rejection as the decision and the served gateRef alone", () => {
    const detail = gateDetail(ONE_CLICK);
    const reject: CommandAction = { ...identityApprovalAction("Reject"), key: "resolve-gate-rejected", intent: "destructive", resolution: "rejected" };
    const parsed = parsedGateAnswer(composeCommandRequest(reject, { runId: runId(1), expectedVersion: 3 }, { ...COMMAND_CONTEXT, gate: available(detail) }));
    assert.deepEqual(parsed.payload, { decision: "rejected", gateRef: detail.gateRef });
  });

  it("refuses when the run detail names no open gate", () => {
    const composed = composeCommandRequest(APPROVE, { runId: runId(1), expectedVersion: 3 }, { ...CONTEXT, gate: available(gateDetail(ONE_CLICK)) });
    assert.equal(composed.state, "refused");
  });
});
