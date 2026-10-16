import { createIdentityCeremonyFixtures, identityApprovalAction } from "../../../../support/helpers/dashboard/identity-ceremony-fixtures.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";

import {
composeCommandRequest,
type CommandAction,
} from "../../../../../src/dashboard/app/commands/command-dispatch.js";
import {
EMPTY_IDENTITY_GATE_DRAFT,
identityCeremonyFor,
identityDraftProblem,
identityGateAnswer,
optionFor,
type IdentityGateDetail,
} from "../../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";

import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { IdentityApprovalResultSchema } from "../../../../../src/rules/separations/identity-approval.js";




const NOW = "2026-08-14T17:00:00.000Z";
/** The EID the document carries and the run checked. */
const CHECKED = "10833507";
/** The person a search on the document's NAME resolves — a different human. */
const NAME_SEARCH = "10203262";
const RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const CONTEXT = { actorId: "local-operator", source: "run-detail" } as const;

const { ONE_CLICK, CHOOSE, TYPE_EID, gateDetail } =
  createIdentityCeremonyFixtures(NOW, CHECKED, NAME_SEARCH, RESULT_SCHEMA_HASH, runId);




/** The three packets the three ceremonies fall out of. */

/** the name agrees, but a search on it resolves a DIFFERENT person */

/** Names that do not match. */




const APPROVE: CommandAction = identityApprovalAction("Approve");

function available(detail: IdentityGateDetail) {
  return { state: "available" as const, value: detail };
}

describe("identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1)", () => {
  it("derives all three shapes from real packet inputs, never from a constant", () => {
    assert.equal(ONE_CLICK.approvalShape, "one-click");
    assert.equal(CHOOSE.approvalShape, "choose-a-candidate");
    assert.equal(TYPE_EID.approvalShape, "type-the-eid");
    // The two risky packets carry BOTH people, which is the whole reason the
    // ceremony exists: the operator is choosing between them.
    assert.equal(CHOOSE.approvableEids.length, 2);
    assert.equal(TYPE_EID.approvableEids.length, 2);
  });

  it("maps each shape to its own control, and a rejection to its own", () => {
    assert.equal(identityCeremonyFor(gateDetail(ONE_CLICK), "approved").kind, "confirm");
    assert.equal(identityCeremonyFor(gateDetail(CHOOSE), "approved").kind, "choose");
    assert.equal(identityCeremonyFor(gateDetail(TYPE_EID), "approved").kind, "type-the-eid");
    assert.equal(identityCeremonyFor(gateDetail(TYPE_EID), "rejected").kind, "reject");
  });

  it("REFUSES an approvalShape this build has no control for — it never falls back to one click", () => {

    const forged = { ...gateDetail(CHOOSE), approvalShape: "biometric-scan" } as unknown as IdentityGateDetail;
    const ceremony = identityCeremonyFor(forged, "approved");
    assert.equal(ceremony.kind, "unsupported");
    assert.match(ceremony.kind === "unsupported" ? ceremony.reason : "", /biometric-scan/);
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
      const ceremony = identityCeremonyFor(gate, "approved");
      assert.equal(ceremony.kind, "unsupported");
      if (ceremony.kind !== "unsupported") continue;
      assert.match(ceremony.reason, diagnostic);
      assert.equal(identityDraftProblem(ceremony, EMPTY_IDENTITY_GATE_DRAFT), ceremony.reason);
      assert.equal(identityGateAnswer(ceremony, EMPTY_IDENTITY_GATE_DRAFT), undefined);
    }
  });
});

describe("identityDraftProblem — the bounds, stated where the value is typed", () => {
  it("asks for a candidate before it will let one be sent", () => {
    const ceremony = identityCeremonyFor(gateDetail(CHOOSE), "approved");
    assert.match(identityDraftProblem(ceremony, EMPTY_IDENTITY_GATE_DRAFT) ?? "", /Pick which candidate/);
    assert.equal(identityDraftProblem(ceremony, { eid: NAME_SEARCH, reason: "" }), undefined);
  });

  it("asks for eight digits, and then for an EID THE PACKET SHOWED", () => {
    const ceremony = identityCeremonyFor(gateDetail(TYPE_EID), "approved");
    assert.match(identityDraftProblem(ceremony, { eid: "107792", reason: "" }) ?? "", /8-digit/);

    assert.match(
      identityDraftProblem(ceremony, { eid: "99999999", reason: "" }) ?? "",
      /identity-approval-eid-not-shown/,
    );
    assert.equal(identityDraftProblem(ceremony, { eid: CHECKED, reason: "" }), undefined);
  });

  it("asks for a rejection reason, and accepts one that is only whitespace-padded", () => {
    const ceremony = identityCeremonyFor(gateDetail(ONE_CLICK), "rejected");
    assert.match(
      identityDraftProblem(ceremony, EMPTY_IDENTITY_GATE_DRAFT) ?? "",
      /Say why this is not the right person/u,
    );
    assert.match(
      identityDraftProblem(ceremony, { eid: "", reason: "   " }) ?? "",
      /Say why this is not the right person/u,
    );
    assert.deepEqual(
      identityGateAnswer(ceremony, { eid: "", reason: "  wrong person  " }),
      { decision: "rejected", reason: "wrong person" },
    );
    assert.equal(identityDraftProblem(ceremony, { eid: "", reason: " wrong person " }), undefined);
  });

  it("carries the unsupported reason through as the problem, so the send stays blocked", () => {
    const forged = { ...gateDetail(CHOOSE), approvalShape: "biometric-scan" } as unknown as IdentityGateDetail;
    const ceremony = identityCeremonyFor(forged, "approved");
    assert.match(identityDraftProblem(ceremony, { eid: CHECKED, reason: "" }) ?? "", /biometric-scan/);
    assert.equal(identityGateAnswer(ceremony, { eid: CHECKED, reason: "" }), undefined);
  });
});

describe("composeCommandRequest — the three ceremonies reach the real command endpoint", () => {
  it("composes a CHOSEN candidate under the server's own chosenFrom label", () => {
    const detail = gateDetail(CHOOSE);
    const composed = composeCommandRequest(
      APPROVE,
      { runId: runId(1), expectedVersion: 3 },
      { ...CONTEXT, gate: available(detail), gateAnswer: { decision: "approved", eid: NAME_SEARCH } },
    );
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;
    const parsed = CommandRequestSchema.parse(composed.request);
    assert.equal(parsed.family, "gate");
    if (parsed.family !== "gate") return;
    assert.equal(parsed.payload.result.schemaHash, detail.resultSchemaHash);
    const result = IdentityApprovalResultSchema.parse(parsed.payload.result.value);
    assert.equal(result.decision, "approved");
    if (result.decision !== "approved") return;
    assert.equal(result.eid, NAME_SEARCH);
    // NOT invented: the label is the served option's, which the post-gate node
    // re-derives and refuses a contradiction to.
    assert.equal(result.chosenFrom, optionFor(detail.options, NAME_SEARCH)?.chosenFrom);
    assert.equal(result.chosenFrom, "name-search");
    assert.equal(result.evidenceDigest, detail.evidenceDigest);
  });
});
