import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, it } from "vitest";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { RuntimeInputSnapshotSchema } from "../../../../src/models/config/secrets.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW, HASH_A, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const CLOCK = manualClock(new Date(NOW));
const databases: AuthorityDatabase[] = [];
const profiles: { close(): Promise<void> }[] = [];
const roots: string[] = [];

async function openDatabase(): Promise<AuthorityDatabase> {
  const profile = await profileFixtures.create();
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, CLOCK);
  profiles.push(profile);
  databases.push(database);
  return database;
}

const identity = (initials: string) =>
  RuntimeInputSnapshotSchema.parse(protectedSecretSource({ profileName: "Lex Rivers", profileInitials: initials }).read());

describe("separations — the stored Timekeeper initials through the start planner", () => {
  afterEach(async () => {
    while (databases.length > 0) databases.pop()?.close();
    for (const profile of profiles.splice(0)) await profile.close();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("admits the stored initials into the planned input only, and a re-plan takes the current value while a captured plan keeps its own", async () => {
    const authority = await openDatabase();
    let current = identity("QZ");
    const deps = { authority, clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000, protectedSecrets: { read: () => current } };
    const request = { descriptor: separationsDescriptor, submissions: [{ documentNumber: "4510" }], dryRun: true,
      priority: "bulk" as const, shape: "single" as const, configFingerprint: HASH_A, configSnapshotId: UUID_4, plannedBy: "local-operator" };

    const first = planStart(deps, request);
    assert.deepEqual(first.refused, []);
    const planned = first.planned[0];
    assert.ok(planned);
    assert.equal(Reflect.get(Object(planned.input.value), "timekeeperInitials"), "QZ");
    assert.equal(Reflect.get(Object(planned.input.value), "timekeeperName"), "Lex Rivers");
    assert.equal(planned.input.protectedBindings?.length, 1);

    const { input: { value: _value, ...inputRest }, ...plannedRest } = planned;
    const outside = JSON.stringify({ ...first, planned: [{ ...plannedRest, input: inputRest }] });
    assert.equal(outside.includes("QZ"), false);
    assert.equal(outside.includes("Lex Rivers"), false);
    assert.equal(planned.title.includes("QZ") || planned.title.includes("Lex Rivers"), false);
    assert.equal((planned.subtitle ?? "").includes("QZ") || (planned.subtitle ?? "").includes("Lex Rivers"), false);

    const captured = JSON.stringify(planned.input);
    current = identity("XW");
    assert.equal(JSON.stringify(planned.input), captured, "a captured plan keeps its value");

    const replanned = planStart(deps, { ...request, retainedInputs: [planned.input] });
    assert.deepEqual(replanned.refused, []);
    assert.equal(Reflect.get(Object(replanned.planned[0]?.input.value), "timekeeperInitials"), "XW");
    assert.equal(Reflect.get(Object(planned.input.value), "timekeeperInitials"), "QZ");
  });
});
