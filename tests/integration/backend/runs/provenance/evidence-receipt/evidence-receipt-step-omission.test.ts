import { testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { buildRunEvidenceReceipt, type ReceiptBuildInput } from "../../../../../../src/backend/runs/provenance/evidence-receipt.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import {
  RunCheckpointRecordSchema,
  type RunCheckpointRecord,
} from "../../../../../../src/models/workflow/checkpoint.js";
import {
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
} from "../../../../../../src/models/run/result.js";
import { RunRecordSchema, type RunRecord } from "../../../../../../src/models/run/record.js";
import type { RunEvidenceReceipt } from "../../../../../../src/models/trust/evidence.js";
import { evidenceEntryRef } from "../../../../../../src/models/trust/evidence-identity.js";
import { buildExplainRunView, renderExplainRun } from "../../../../../../src/backend/runs/explain/explain-run.js";
import { EXIT_RUN_ID, seedPersonLookupExitRun } from "../../../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The omitted step's key. The receipt binds it to the run ENVELOPE, never to a descriptor timeline. */
const STEP = "crm-read";
const ASSERTED_AT = "2026-08-04T00:10:00.000Z";
/** The node the step's producer rebuilt, and the node of that step nothing rebuilt. */
const ASSERTED_NODE = "active-status";
const OMITTED_NODE = "crm-dates";
/** What the operator typed. It is authority's, and it may never appear in a receipt. */
const TYPED_FACT = "a1ZVr000004TypedMAC";

interface Fixture {
  readonly run: RunRecord;
  readonly result: RunResultRecord;
  readonly checkpoints: readonly RunCheckpointRecord[];
}

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-omission-receipt-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "omission-receipt-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), { path: join(root, "state.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  return database;
}


function omittedStepFixture(overrides?: Readonly<{
  stepOmissions?: readonly { readonly step: string; readonly facts: Record<string, string> }[];
  dropAssertedCheckpoint?: boolean;
  citeAssertedAsResolved?: boolean;
  dropAssertionMarker?: boolean;

  citeForeignSchemaHash?: boolean;
  /** Cite a DIFFERENT output digest than the row's own value hashes to. */
  citeForeignOutputDigest?: boolean;
  /** Cite the marked node as `not-run` instead of `asserted`. */
  citeAssertedAsNotRun?: boolean;
  /** Leave the marked node out of the terminal record's dependencies entirely. */
  dropAssertedDependency?: boolean;
}>): Fixture {
  const database = openDatabase();
  const seeded = seedPersonLookupExitRun(database);
  const storedResult = database.authority.runResults.get(EXIT_RUN_ID);
  assert.ok(storedResult !== undefined, "the seeded exit run must have a terminal result");

  const checkpoints = seeded.checkpoints.map((row) => RunCheckpointRecordSchema.parse(row));
  const assertedSource = checkpoints.find((row) => String(row.nodeId) === ASSERTED_NODE);
  assert.ok(assertedSource !== undefined, `the seed must hold a ${ASSERTED_NODE} checkpoint`);

  const asserted = RunCheckpointRecordSchema.parse({
    ...assertedSource,
    ...(overrides?.dropAssertionMarker === true
      ? {}
      : { assertion: { step: STEP, assertedAt: ASSERTED_AT } }),
    provenance: assertedSource.provenance.map((fact) => ({
      path: fact.path,
      source: "operator",
      observedAt: ASSERTED_AT,
      originalObservedAt: ASSERTED_AT,
    })),
  });

  /* A different, well-formed fingerprint — never the one the row's own value derives. */
  const foreign = deriveCheckpointOutputDigest({ schemaHash: asserted.output.schemaHash, value: { foreign: true } });

  const dependencies = storedResult.dependencies
    .filter((dependency) => !(
      overrides?.dropAssertedDependency === true && String(dependency.nodeId) === ASSERTED_NODE
    ))
    .map((dependency) => {
      if (String(dependency.nodeId) === ASSERTED_NODE) {
        if (overrides?.citeAssertedAsResolved === true) return dependency;
        if (overrides?.citeAssertedAsNotRun === true) {
          return { state: "not-run" as const, nodeId: dependency.nodeId, reason: "step-omitted" as const };
        }
        return {
          state: "asserted" as const,
          nodeId: dependency.nodeId,
          step: STEP,
          assertedAt: ASSERTED_AT,
          outputSchemaHash: overrides?.citeForeignSchemaHash === true ? foreign : asserted.output.schemaHash,
          outputDigest: overrides?.citeForeignOutputDigest === true
            ? foreign
            : deriveCheckpointOutputDigest(asserted.output),
        };
      }
      if (String(dependency.nodeId) === OMITTED_NODE) {
        return { state: "not-run" as const, nodeId: dependency.nodeId, reason: "step-omitted" as const };
      }
      return dependency;
    });

  const result = RunResultRecordSchema.parse({
    ...storedResult,
    dependencies,
    dependencyDigest: deriveTerminalDependencyDigest(dependencies),
  });

  const stepOmissions = overrides?.stepOmissions
    ?? [{ step: STEP, facts: { recordId: TYPED_FACT } }];
  const run = RunRecordSchema.parse({
    ...seeded.run,
    envelope: {
      ...seeded.run.envelope,
      ...(stepOmissions.length === 0 ? {} : { stepOmissions }),
    },
  });

  return {
    run,
    result,
    checkpoints: overrides?.dropAssertedCheckpoint === true
      ? checkpoints.filter((row) => String(row.nodeId) !== ASSERTED_NODE)
      : checkpoints.map((row) => (String(row.nodeId) === ASSERTED_NODE ? asserted : row)),
  };
}

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
      /\[MOVED\] terminal-dependency-set — the stored result was built from \[crm-dates\]/u,
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

  it("lists the omitted step keys and renders them as their own section", () => {
    const view = explainView();
    assert.deepEqual(view.omittedSteps, [STEP]);
    const rendered = renderExplainRun(view);
    assert.match(rendered, /omitted steps\n\s+crm-read — omitted at start/u);
    assert.equal(rendered.includes(TYPED_FACT), false);
  });

  it("still calls a node of the omitted step that nothing rebuilt not-run", () => {
    const entry = explainView().timeline.find((row) => row.nodeId === OMITTED_NODE);
    assert.ok(entry !== undefined);
    assert.equal(entry.disposition, "not-run");
    assert.match(entry.detail, /step-omitted/u);
  });
});
