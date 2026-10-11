import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { buildExplainRunView,renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import {
RunResultRecordSchema,
deriveCheckpointOutputDigest,
deriveTerminalDependencyDigest,
type RunResultRecord,
} from "../../../../src/models/run/result.js";
import {
RunCheckpointRecordSchema,
type RunCheckpointRecord,
} from "../../../../src/models/workflow/checkpoint.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { EXIT_RUN_ID,seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

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

  it("lists the omitted step keys and renders them as their own section", () => {
    const view = explainView();
    assert.deepEqual(view.omittedSteps, [STEP]);
    const rendered = renderExplainRun(view);
    assert.match(rendered, /omitted steps\n\s+crm-read — omitted at start/u);
    assert.equal(rendered.includes(TYPED_FACT), false);
  });
});
