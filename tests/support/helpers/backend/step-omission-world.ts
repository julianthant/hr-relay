import { createBoundProfileFixture, type BoundProfileStorageFixture } from "../admission-fixture.js";
import { testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema, deriveCheckpointOutputDigest, deriveTerminalDependencyDigest, type RunResultRecord } from "../../../../src/models/run/result.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { EXIT_RUN_ID, seedPersonLookupExitRun } from "../../fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

export interface Fixture {
  readonly run: RunRecord;
  readonly result: RunResultRecord;
  readonly checkpoints: readonly RunCheckpointRecord[];
}



export function createStepOmissionTestWorld(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  const profiles: BoundProfileStorageFixture[] = [];
  const databases: AuthorityDatabase[] = [];

  const STEP = "crm-read";

  const ASSERTED_AT = "2026-08-04T00:10:00.000Z";

  const ASSERTED_NODE = "active-status";

  const OMITTED_NODE = "crm-dates";

  const TYPED_FACT = "a1ZVr000004TypedMAC";

  async function openDatabase(): Promise<AuthorityDatabase> {
    const profile = await profileFixture();
    profiles.push(profile);
    const clock = manualClock(new Date("2026-08-04T00:11:13.500Z"));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "omission-receipt-test" },
      clock,
    );
    testWorkerPorts(database, clock, { path: profile.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    databases.push(database);
    return database;
  }

  async function omittedStepFixture(overrides?: Readonly<{
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
  }>): Promise<Fixture> {
    const database = await openDatabase();
    const seeded = database.withAuthorityTransaction(() => seedPersonLookupExitRun(database));
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
  const cleanup = async () => {
    for (const database of databases.splice(0)) database.close();
    for (const profile of profiles.splice(0)) await profile.close();
  };
  return { databases, STEP, TYPED_FACT, omittedStepFixture, ASSERTED_AT, ASSERTED_NODE, OMITTED_NODE, cleanup };
}
