/**
 * D307 — `fanOutQueuedRuns` (src/core/run-fan-out.ts) is the ONE place N
 * queued runs are inserted; every start/retry/relaunch door funnels through
 * it. Its `FanOutEnvelope.stepOmissions` must ride onto every fanned-out run's
 * envelope byte for byte, the same way `captureBrowserScreenshots` already
 * does.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { fanOutQueuedRuns } from "../../src/core/run-fan-out.js";
import { manualClock } from "../../src/domain/clock.js";
import { deriveItemId } from "../../src/domain/identifiers.js";
import { ActorIdSchema, StartPlanIdSchema } from "../../src/domain/ids.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import type { StepOmissions } from "../../src/domain/workflow/step-omission.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupInput,
  personLookupDescriptor,
} from "../../src/workflows/person-lookup/descriptor.js";
import { HASH_A, NOW, UUID_4 } from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-fan-out-omission-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  databases.push(database);
  return database;
}

function plannedEntry(runId: string, eid: string) {
  return {
    runId,
    itemId: deriveItemId("person-lookup", `eid:${eid}`),
    traceId: `pl-170000-${runId.slice(0, 4)}`,
    matchKey: `eid:${eid}`,
    rawInput: { emplId: eid },
    parsedInput: {
      schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
      value: { emplId: eid, keepNonHdh: false, includeCrmDates: false },
    },
  };
}

function baseEnvelope(sessionId: string, stepOmissions?: StepOmissions) {
  return {
    workflow: personLookupDescriptor.id,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    resolvedInstance: { ucpath: "prod" as const, crm: "prod" as const },
    configFingerprint: HASH_A,
    configSnapshotId: UUID_4,
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

describe("fanOutQueuedRuns (D307)", () => {
  it("carries stepOmissions onto every fanned-out run's envelope byte for byte", () => {
    const database = openDatabase();
    const stepOmissions = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/18/2026", separationDate: "06/19/2026" } }];
    database.withAuthorityTransaction((repositories) => fanOutQueuedRuns(
      repositories,
      (message) => { throw new Error(message); },
      personLookupDescriptor,
      baseEnvelope("bbbbbbbb-0001-4000-8000-000100000000", stepOmissions),
      [plannedEntry("aaaaaaaa-1001-4000-8000-100100000000", "10873698")],
      NOW,
      "fixture fan-out",
    ));
    const run = database.authority.runs.get("aaaaaaaa-1001-4000-8000-100100000000");
    assert.ok(run !== undefined);
    assert.deepEqual(run.envelope.stepOmissions, stepOmissions);
  });

  it("omits stepOmissions entirely from the envelope when the fan-out carries none", () => {
    const database = openDatabase();
    database.withAuthorityTransaction((repositories) => fanOutQueuedRuns(
      repositories,
      (message) => { throw new Error(message); },
      personLookupDescriptor,
      baseEnvelope("bbbbbbbb-0002-4000-8000-000200000000"),
      [plannedEntry("aaaaaaaa-1002-4000-8000-100200000000", "10001573")],
      NOW,
      "fixture fan-out",
    ));
    const run = database.authority.runs.get("aaaaaaaa-1002-4000-8000-100200000000");
    assert.ok(run !== undefined);
    assert.equal(Object.hasOwn(run.envelope, "stepOmissions"), false);
  });
});
