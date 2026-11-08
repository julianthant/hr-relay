import assert from "node:assert/strict";
import { it } from "vitest";
import { composeProfileActivity, type ProfileCommandActivity } from "../../../../src/backend/app/composition/storage-compose.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

type Input = Parameters<typeof composeProfileActivity>[0];
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const empty = { reservations: [], slots: [], leases: [], browsers: [], controls: [], runs: [], writeIntents: [], duoLeases: [], exclusiveSessionLeases: [], pendingArtifacts: [] };

function activity(facts: Partial<typeof empty>, commands: ProfileCommandActivity[] = []) {
  const custody = { ...empty, ...facts };
  return composeProfileActivity({
    commandActivities: new Set(commands),
    admission: { profileBinding: { profileId: PROFILE_ID }, assertLive() {} } as unknown as Input["admission"],
    database: { readProfileResourceCustody: () => custody, hasWorkerNonBirth: () => false } as unknown as Input["database"],
    clock: manualClock(new Date("2026-11-07T21:56:00.000Z")),
    supervisor: { state: "not-constructed" },
    lifecycle: {} as Input["lifecycle"],
  });
}

it("names the same holds that keep the drain busy: a non-terminal run and a pending artifact", () => {
  const held = activity({ runs: [{ lifecycle: { state: "queued" } }], pendingArtifacts: [{}] } as unknown as Partial<typeof empty>);
  assert.equal(held.hasUnquiescedWork(PROFILE_ID), true);
  assert.equal(held.busyReason(PROFILE_ID), "busy-runs-1-artifacts-1");
  const artifactOnly = activity({ pendingArtifacts: [{}] } as unknown as Partial<typeof empty>);
  assert.equal(artifactOnly.hasUnquiescedWork(PROFILE_ID), true);
  assert.equal(artifactOnly.busyReason(PROFILE_ID), "busy-artifacts-1");
});

it("names an unquiesced command when it is the only hold, and an open exclusive session is not a hold", () => {
  const command: ProfileCommandActivity = { hasUnquiescedWork: () => true, requestCancellation() {}, awaitCancellation: () => Promise.resolve() };
  const held = activity({ exclusiveSessionLeases: [{ releasedAt: null }] } as unknown as Partial<typeof empty>, [command]);
  assert.equal(held.hasUnquiescedWork(PROFILE_ID), true);
  assert.equal(held.busyReason(PROFILE_ID), "busy-commands-1");
  const idle = activity({ exclusiveSessionLeases: [{ releasedAt: null }] } as unknown as Partial<typeof empty>);
  assert.equal(idle.hasUnquiescedWork(PROFILE_ID), false);
  assert.equal(idle.busyReason(PROFILE_ID), "busy-none");
});
