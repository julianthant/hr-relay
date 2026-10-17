import { createStepOmissionTestWorld, type Fixture } from "../../../support/helpers/backend/step-omission-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildExplainRunView } from "../../../../src/backend/runs/explain/explain-run.js";
import { buildRunEvidenceReceipt, type ReceiptBuildInput } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { evidenceEntryRef } from "../../../../src/models/trust/evidence-identity.js";
import type { RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const {STEP, ASSERTED_AT, ASSERTED_NODE, OMITTED_NODE, TYPED_FACT, omittedStepFixture, cleanup } = createStepOmissionTestWorld();


afterEach(cleanup);

function receiptInput(fixture: Fixture): ReceiptBuildInput {
  return {
    descriptor: personLookupDescriptor,
    run: fixture.run,
    result: fixture.result,
    checkpoints: fixture.checkpoints,
  };
}

function nodeObligation(receipt: RunEvidenceReceipt, nodeId: string) {
  const row = receipt.verification.find((entry) => entry.obligation === `node.${nodeId}`);
  assert.ok(row !== undefined, `receipt must carry an obligation for node ${nodeId}`);
  return row;
}

describe("evidence receipt under step omission", () => {
  it("states an asserted node as present, mandatory, and sourced from the operator", () => {
    const receipt = buildRunEvidenceReceipt(receiptInput(omittedStepFixture()));

    const obligation = nodeObligation(receipt, ASSERTED_NODE);
    assert.equal(obligation.verdict, "present");
    assert.equal(obligation.mandatory, true);

    const decision = receipt.decisions.find((entry) => entry.kind === "assertion");
    assert.ok(decision !== undefined, "an asserted node contributes one assertion decision");
    assert.equal(decision.outcome, "taken");
    assert.match(decision.reason, /the operator omitted step "crm-read" at start/u);
    assert.match(decision.reason, new RegExp(ASSERTED_AT, "u"));

    const facts = receipt.observations.filter((fact) => fact.source.kind === "operator-assertion");
    assert.ok(facts.length > 0, "the asserted node's leaves are operator-assertion facts");
    for (const fact of facts) {
      assert.ok(fact.source.kind === "operator-assertion");
      assert.equal(fact.source.step, STEP);
      assert.equal(fact.source.assertedAt, ASSERTED_AT);
      assert.equal(fact.source.taskId, "workflow:person-lookup/read-active-status");
    }
  });

  it("gives an asserted node no read action and no freshness reuse", () => {
    const receipt = buildRunEvidenceReceipt(receiptInput(omittedStepFixture()));

    assert.deepEqual(
      receipt.actions.filter((action) => action.taskId === "workflow:person-lookup/read-active-status"),
      [],
      "nothing read this node; an action row would name a read that never happened",
    );
    const assertedVerification = nodeObligation(receipt, ASSERTED_NODE).id;
    assert.deepEqual(
      receipt.reuse.filter((entry) => entry.source === `verification:${assertedVerification}`),
      [],
      "an assertion reused no observation, so it has no age to compare against a limit",
    );
  });

  it("keeps a node of the omitted step that nothing rebuilt absent and not mandatory", () => {
    const receipt = buildRunEvidenceReceipt(receiptInput(omittedStepFixture()));

    const obligation = nodeObligation(receipt, OMITTED_NODE);
    assert.equal(obligation.verdict, "absent");
    assert.equal(obligation.mandatory, false);
    const decision = receipt.decisions.find((entry) => entry.reason.includes(`node "${OMITTED_NODE}"`));
    assert.ok(decision !== undefined);

    assert.equal(
      decision.reason,
      `node "${OMITTED_NODE}" did not run: the operator omitted its step at start`,
    );
    assert.equal(decision.kind, "branch");
    assert.equal(decision.outcome, "not-taken");
  });

  it("names the omitted step keys once, carries no typed fact, and refuses verified-done", () => {
    const receipt = buildRunEvidenceReceipt(receiptInput(omittedStepFixture()));

    const warnings = receipt.warnings.filter((warning) => warning.code === "OPERATOR_OMITTED_STEP");
    assert.equal(warnings.length, 1, "the omission is stated once for the run, not once per node");
    const warning = warnings[0];
    assert.ok(warning !== undefined);
    assert.equal(warning.loadBearing, true);
    assert.equal(warning.summary.split(STEP).length - 1, 1, "the step key is named exactly once");

    const serialized = JSON.stringify(receipt);
    assert.equal(serialized.includes(TYPED_FACT), false, "the operator's typed facts stay in authority");

    assert.equal(receipt.result, "partial");
    assert.equal(receipt.confidence, "partial");
  });

  it("refuses a terminal citation with no marked row behind it", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ dropAssertedCheckpoint: true }))),
      /cites node "active-status" as asserted for step "crm-read", and authority holds no checkpoint row/u,
    );
  });

  it("refuses an assertion for a step this run's envelope never omitted", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ stepOmissions: [] }))),
      /asserted for step "crm-read", and its envelope omits no step/u,
    );
  });

  it("refuses a terminal record that calls the asserted node resolved", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ citeAssertedAsResolved: true }))),
      /may not call an asserted value an observed one/u,
    );
  });

  it("refuses a citation whose output schema is not the one that parsed the row", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ citeForeignSchemaHash: true }))),
      /disagree about which schema bound this assertion's value/u,
    );
  });

  it("refuses a citation whose output digest is not the row's own value", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ citeForeignOutputDigest: true }))),
      /the terminal derive did not consume the value this row carries/u,
    );
  });

  it("refuses a marked row the terminal record calls not-run", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ citeAssertedAsNotRun: true }))),
      /cites node "active-status" as not-run \(step-omitted\).*may not call an asserted value a node that produced nothing/su,
    );
  });


  it("refuses a marked row the terminal record leaves out of a dependency the derive declares", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({ dropAssertedDependency: true }))),
      /\[MOVED\] terminal-dependency-set — the stored result was built from \[search-identity, crm-identity, matching, crm-selected-record, crm-results, crm-dates\]/u,
    );
  });

  it("points the asserted obligation at its facts, never back at the decision that cites it", () => {
    const receipt = buildRunEvidenceReceipt(receiptInput(omittedStepFixture()));

    const obligation = nodeObligation(receipt, ASSERTED_NODE);
    const decision = receipt.decisions.find((entry) => entry.kind === "assertion");
    assert.ok(decision !== undefined);
    assert.ok(
      decision.evidence.includes(evidenceEntryRef(obligation.id)),
      "the assertion decision explains the obligation, so it cites it",
    );
    assert.equal(
      obligation.evidence.includes(evidenceEntryRef(decision.id)),
      false,
      "and the obligation must not cite the decision back: a 2-cycle walks a reader in a circle",
    );
    const factIds = new Set(receipt.observations.map((fact) => evidenceEntryRef(fact.id)));
    assert.ok(obligation.evidence.length > 0, "it cites the asserted facts instead");
    for (const ref of obligation.evidence) {
      assert.ok(factIds.has(ref), "an asserted obligation's evidence is its facts");
    }
  });

  it("refuses operator-sourced leaves on a row that carries no assertion marker", () => {
    assert.throws(
      () => buildRunEvidenceReceipt(receiptInput(omittedStepFixture({
        dropAssertionMarker: true,
        citeAssertedAsResolved: true,
      }))),
      /operator-sourced provenance row .* that is not an operator correction/u,
    );
  });
});

describe("explain run under step omission", () => {
  function explainView() {
    const fixture = omittedStepFixture();
    return buildExplainRunView({
      run: fixture.run,
      checkpoints: fixture.checkpoints,
      writes: [],
      nodeIds: fixture.result.dependencies.map((dependency) => String(dependency.nodeId)),
      dependencies: fixture.result.dependencies.map((dependency) => ({
        nodeId: String(dependency.nodeId),
        state: dependency.state === "not-run" ? dependency.reason : dependency.state,
      })),
    });
  }

  it("gives an asserted node its own disposition, its step and its instant", () => {
    const view = explainView();
    const entry = view.timeline.find((row) => row.nodeId === ASSERTED_NODE);
    assert.ok(entry !== undefined);
    assert.equal(entry.disposition, "operator-asserted");
    assert.match(entry.detail, /omitted step "crm-read" at start/u);
    assert.match(entry.detail, new RegExp(`asserted at ${ASSERTED_AT}`, "u"));
    assert.match(entry.detail, /observed by nobody/u);
  });

  it("still calls a node of the omitted step that nothing rebuilt not-run", () => {
    const entry = explainView().timeline.find((row) => row.nodeId === OMITTED_NODE);
    assert.ok(entry !== undefined);
    assert.equal(entry.disposition, "not-run");
    assert.match(entry.detail, /step-omitted/u);
  });
});
