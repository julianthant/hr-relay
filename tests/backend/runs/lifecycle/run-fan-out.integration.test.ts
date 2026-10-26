import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { fanOutQueuedRuns } from "../../../../src/backend/runs/lifecycle/run-fan-out.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import type { StepOmissions } from "../../../../src/models/workflow/step-omission.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema,StartPlanIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput,PersonLookupInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { NOW,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function openDatabase(): AuthorityDatabase {
  const profile = createBoundProfileFixture();
  const database = AuthorityDatabase.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  const close = database.close.bind(database);
  database.close = () => { close(); profile.close(); };
  seedSyntheticRuntimeConfig(database);
  databases.push(database);
  return database;
}

function plannedEntry(eid: string) {
  return {
    itemId: deriveItemId("person-lookup", `eid:${eid}`),
    title: `EID ${eid}`,
    matchKey: `eid:${eid}`,
    rawInput: { emplId: eid },
    parsedInput: {
      protectedBindings: [],
      schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
      value: { emplId: eid, keepNonHdh: false, includeCrmDates: false },
    },
  };
}

function baseEnvelope(database: AuthorityDatabase, sessionId: string, stepOmissions?: StepOmissions) {
  const active = database.authority.runtimeConfig.get();
  assert.ok(active);
  return {
    commandId: sessionId, actorId: "local-operator",
    workflow: personLookupDescriptor.id,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    resolvedInstance: { ucpath: "prod" as const, crm: "prod" as const },
    configFingerprint: active.configFingerprint,
    configSnapshotId: active.configSnapshotId,
    shape: "single" as const,
    priority: "bulk" as const,
    dryRun: false,
    ...(stepOmissions === undefined ? {} : { stepOmissions }),
    ingressSchemaHash: deriveSchemaHash(PersonLookupInput, "input"),
    appVersion: "0.1.0",
    session: {
      sessionId,
      origin: { kind: "start-plan" as const, startPlanId: StartPlanIdSchema.parse(UUID_4), actorId: ActorIdSchema.parse("local-operator") },
    },
  };
}

describe("fanOutQueuedRuns", () => {
  it("carries stepOmissions onto every fanned-out run's envelope byte for byte", () => {
    const database = openDatabase();
    const stepOmissions = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];
    database.withAuthorityTransaction((repositories) => fanOutQueuedRuns(
      repositories,
      new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} }),
      (message) => { throw new Error(message); },
      personLookupDescriptor,
      baseEnvelope(database, "bbbbbbbb-0001-4000-8000-000100000000", stepOmissions),
      [plannedEntry("10873698")],
      NOW,
      "fixture fan-out",
    ));
    const run = database.authority.runs.listByWorkflow("person-lookup")[0];
    assert.ok(run !== undefined);
    assert.deepEqual(run.envelope.stepOmissions, stepOmissions);
  });

  it("omits stepOmissions entirely from the envelope when the fan-out carries none", () => {
    const database = openDatabase();
    database.withAuthorityTransaction((repositories) => fanOutQueuedRuns(
      repositories,
      new RunRecordService({ database, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("a"), publishQueued: () => {} }),
      (message) => { throw new Error(message); },
      personLookupDescriptor,
      baseEnvelope(database, "bbbbbbbb-0002-4000-8000-000200000000"),
      [plannedEntry("10101010")],
      NOW,
      "fixture fan-out",
    ));
    const run = database.authority.runs.listByWorkflow("person-lookup")[0];
    assert.ok(run !== undefined);
    assert.equal(Object.hasOwn(run.envelope, "stepOmissions"), false);
  });
});
