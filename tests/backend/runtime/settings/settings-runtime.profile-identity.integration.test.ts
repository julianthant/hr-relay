import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { createCredentialSecretSource, readAdmittedProfileIdentity } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { HASH_A, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createProfileSessionWorld } from "../../../support/helpers/backend/profile-session-world.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";

const worlds: Awaited<ReturnType<typeof createProfileSessionWorld>>[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const world of worlds.splice(0)) await world.close();
});

describe("workflow timekeeper identity after a profile details edit", () => {
  it("starts new runs with the changed timekeeper name while a run planned before the change keeps the name it captured", async () => {
    const machine = await createProfileSessionWorld();
    worlds.push(machine);
    const session = machine.open();
    const alex = await machine.signUp(session, { firstName: "Alex", lastName: "Rivera", email: "alex@ucsd.edu", password: "secret-one", createdAt: "2026-09-06T12:00:00.000Z" });
    const owner = machine.machine.admitProfile(alex.profileId);
    releases.push(() => owner.release());
    const store = createCredentialStore({ admission: owner, stateRoot: owner.stateRoot });
    const protectedSecrets = createCredentialSecretSource(store, () => readAdmittedProfileIdentity(machine.machine, owner));
    const clock = manualClock(new Date("2026-09-06T12:10:00.000Z"));
    const plan = () => planStart({ protectedSecrets, authority: { authority: { runs: { listByItem: () => [] } } }, clock, ids: sequentialIdFactory(), planTtlMs: 600_000 },
      { descriptor: separationsDescriptor, submissions: [{ documentNumber: "4510" }], dryRun: true, priority: "bulk", shape: "single",
        configFingerprint: HASH_A, configSnapshotId: UUID_4, plannedBy: "local-operator" });
    const timekeeper = (record: ReturnType<typeof plan>) => z.object({ timekeeperName: z.string() }).parse(record.planned[0]?.input.value).timekeeperName;

    const before = plan();
    assert.equal(timekeeper(before), "Alex Rivera");

    // The admission captured before the edit stays usable: names are no longer part of its storage claim.
    assert.equal(session.changeDetails(alex.token, { name: { firstName: "Alexis", lastName: "Rivers" }, initials: "AXR", timekeeperName: "Lex Rivers" }).state, "changed");
    const identity = readAdmittedProfileIdentity(machine.machine, owner);
    assert.deepEqual([identity.displayName, identity.initials], ["Lex Rivers", "LR"]);
    const after = plan();
    assert.equal(timekeeper(after), "Lex Rivers");
    assert.deepEqual(after.planned[0]?.input.protectedBindings, before.planned[0]?.input.protectedBindings);
  });
});
