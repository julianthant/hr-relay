/**
 * D307 — what the RECEIPT and EXPLAIN say about an omitted step.
 *
 * The seam is the pair of projections an operator reads after the fact:
 * `buildRunEvidenceReceipt` and `buildExplainRunView`. Both are given real
 * authority records — the seeded person-lookup exit run, its real terminal
 * result and its real checkpoint rows — with ONE node turned into what the
 * executor writes for an omitted step's producer (a marked checkpoint whose
 * every provenance leaf is operator-sourced) and ONE turned into a node of
 * that step nothing rebuilt.
 *
 * The question every assertion answers is the same: can either surface be read
 * as saying a system was checked? An asserted value is `present` and named as
 * the operator's; it is never `verified`, never dated as an observation, never
 * an action anyone took, and never freshness anyone reused.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { buildRunEvidenceReceipt, type ReceiptBuildInput } from "../../src/core/evidence-receipt.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  RunCheckpointRecordSchema,
  type RunCheckpointRecord,
} from "../../src/domain/workflow/checkpoint.js";
import {
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
} from "../../src/domain/run/result.js";
import { RunRecordSchema, type RunRecord } from "../../src/domain/run/record.js";
import type { RunEvidenceReceipt } from "../../src/domain/trust/evidence.js";
import { buildExplainRunView, renderExplainRun } from "../../src/server/explain/explain-run.js";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import { EXIT_RUN_ID, seedPersonLookupExitRun } from "./fixtures/receipt-run-fixtures.js";

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
  const root = mkdtempSync(join(tmpdir(), "hrauto-omission-receipt-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "omission-receipt-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  databases.push(database);
  return database;
}

/**
 * The seeded run, rewritten into the shape the executor leaves behind for an
 * omitted step: the envelope carries the omission, the producer's node carries
 * a MARKED checkpoint with operator provenance, and the terminal record cites
 * one node `asserted` and the other `not-run` for `step-omitted`.
 */
function omittedStepFixture(overrides?: Readonly<{
  stepOmissions?: readonly { readonly step: string; readonly facts: Record<string, string> }[];
  dropAssertedCheckpoint?: boolean;
  citeAssertedAsResolved?: boolean;
  dropAssertionMarker?: boolean;
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

  const dependencies = storedResult.dependencies.map((dependency) => {
    if (String(dependency.nodeId) === ASSERTED_NODE) {
      return overrides?.citeAssertedAsResolved === true
        ? dependency
        : {
          state: "asserted" as const,
          nodeId: dependency.nodeId,
          step: STEP,
          assertedAt: ASSERTED_AT,
          outputSchemaHash: asserted.output.schemaHash,
          outputDigest: deriveCheckpointOutputDigest(asserted.output),
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

describe("evidence receipt under step omission (D307)", () => {
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
    assert.match(decision.reason, /the operator omitted its step at start/u);
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

describe("explain run under step omission (D307)", () => {
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
