import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { composeProfileRuntime, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

type Custody = ReturnType<AuthorityDatabase["readProfileResourceCustody"]>;

/** Signs in on a real bound profile and counts every full custody reading the shutdown takes; closure readings are the ones prepareCurrent takes. */
async function shutdownWith(closureReading: (reading: Custody, index: number) => Custody) {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-16T08:00:00.000Z"));
  const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null } });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  if (active.state !== "active") throw new Error("genuine session required");
  const database = runtime.selectedContext(active.token).database;
  const read = database.readProfileResourceCustody.bind(database), readings = { all: 0, closure: 0 };
  vi.spyOn(database, "readProfileResourceCustody").mockImplementation(() => {
    readings.all++;
    if (!(new Error().stack ?? "").includes("prepareCurrent")) return read();
    return closureReading(read(), readings.closure++);
  });
  const outcome = await runtime.close("shutdown").then(() => undefined, (error: unknown) => error);
  vi.restoreAllMocks();
  if (outcome !== undefined) database.close();
  await f.close();
  return { outcome, readings };
}

const refusal = (outcome: unknown) => {
  assert.ok(outcome instanceof RuntimeCustodyUncertainError);
  const [cause] = outcome.errors as unknown[];
  assert.ok(cause instanceof Error);
  return cause.message;
};

it("one shutdown without a worker pool reads the full custody six times: two quiet checks of two readings each, then the two closure readings", async () => {
  const { outcome, readings } = await shutdownWith(reading => reading);
  assert.equal(outcome, undefined);
  assert.deepEqual(readings, { all: 6, closure: 2 });
});

it("a source that changes between the two closure readings refuses the shutdown", async () => {
  const { outcome, readings } = await shutdownWith((reading, index) => index === 1 ? { ...reading, authorityGeneration: reading.authorityGeneration + 1 } : reading);
  assert.equal(refusal(outcome), "profile-closure-source-changed");
  assert.equal(readings.closure, 2);
});

it("a session not released in the first closure reading refuses the shutdown before a second reading", async () => {
  const { outcome, readings } = await shutdownWith(reading => ({ ...reading,
    exclusiveSessionLeases: [{ ...reading.exclusiveSessionLeases[0], releasedAt: null }] }));
  assert.equal(refusal(outcome), "credential-maintenance-custody-unproved");
  assert.equal(readings.closure, 1);
});
