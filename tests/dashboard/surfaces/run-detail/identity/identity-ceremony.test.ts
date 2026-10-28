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

const { ONE_CLICK, CHOOSE, NAME_MISMATCH, gateDetail } =
  createIdentityCeremonyFixtures(NOW, CHECKED, NAME_SEARCH, RESULT_SCHEMA_HASH, runId);




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
      assert.equal(identityDraftProblem(ceremony, ""), ceremony.reason);
    }
  });
});

describe("identityDraftProblem — only a shown candidate can be sent", () => {
  it("asks for a candidate, refuses one the packet never showed, and accepts a shown one", () => {
    const ceremony = identityCeremonyFor(gateDetail(CHOOSE));
    assert.match(identityDraftProblem(ceremony, "") ?? "", /Pick which candidate/);
    assert.match(identityDraftProblem(ceremony, "99999999") ?? "", /not one of the candidates/);
    assert.equal(identityDraftProblem(ceremony, NAME_SEARCH), undefined);
  });

  it("carries the unsupported reason through as the problem, so the send stays blocked", () => {
    const forged = { ...gateDetail(CHOOSE), approvalShape: "biometric-scan" } as unknown as IdentityGateDetail;
    assert.match(identityDraftProblem(identityCeremonyFor(forged), CHECKED) ?? "", /biometric-scan/);
  });
});

describe("composeCommandRequest — the ceremonies reach the real command endpoint", () => {
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
