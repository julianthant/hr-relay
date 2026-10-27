import { testWorkerPorts } from "../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { FingerprintSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import {
assertDuoCeremonyLeaseToken,
isDuoCeremonyLeaseToken,
} from "../../src/workflow-kit/duo-ceremony-lease.js";
import { openBoundDatabaseFixture } from "../support/helpers/admission-fixture.js";
import type { AuthorityDatabase } from "../support/helpers/synthetic-storage-admission.js";

const CREDENTIAL = FingerprintSchema.parse("ab".repeat(32));
const OTHER_CREDENTIAL = FingerprintSchema.parse("cd".repeat(32));
const TTL_MS = 80_000;
const T0 = "2026-08-21T10:00:00.000Z";

const closers: (() => void | Promise<void>)[] = [];
async function openDatabase(): Promise<AuthorityDatabase> {
  const clock = manualClock(new Date(T0));
  const opened = await openBoundDatabaseFixture("unit-test", clock);
  closers.push(async () => await opened.close());
  for (const poolIndex of [1, 2]) testWorkerPorts(opened.database, clock, { path: opened.path, descriptor: personLookupDescriptor, poolIndex });
  assert.deepEqual(opened.database.authority.workerSlots.list().map(slot => slot.workerId), ["person-lookup-worker-1", "person-lookup-worker-2"]);
  return opened.database;
}
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

describe("duo_ceremony_leases — acquire / release / takeover", () => {
  it("acquires a free credential at generation 1 and mints the one token the helpers accept", async () => {
    const database = await openDatabase();
    const outcome = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-1", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    assert.equal(outcome.state, "acquired");
    if (outcome.state !== "acquired") return;
    assert.equal(outcome.lease.generation, 1);
    assert.equal(outcome.lease.holder.workerId, "person-lookup-worker-1");
    assert.equal(outcome.lease.holder.system, "ucpath");
    assert.equal(outcome.lease.state, "held");
    assert.equal(outcome.lease.expiresAt, at(TTL_MS));
    assert.equal(outcome.tookOver, null);
    assert.equal(isDuoCeremonyLeaseToken(outcome.token), true);
    assert.doesNotThrow(() => assertDuoCeremonyLeaseToken(outcome.token, { system: "ucpath" }));
    assert.throws(
      () => assertDuoCeremonyLeaseToken(outcome.token, { system: "crm" }),
      /minted for ucpath, not crm/,
    );
    assert.equal(outcome.token.credentialKey, CREDENTIAL);
    assert.equal(outcome.token.generation, 1);
    const stored = database.authority.duoCeremonyLeases.get(CREDENTIAL);
    assert.deepEqual(stored, outcome.lease);
    database.close();
  });

  it("refuses a second acquirer while the lease is live, naming the holder", async () => {
    const database = await openDatabase();
    database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-1", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    const second = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-2", system: "crm", now: at(1_000), ttlMs: TTL_MS,
    });
    assert.equal(second.state, "held");
    if (second.state !== "held") return;
    assert.equal(second.holder.holder.workerId, "person-lookup-worker-1");
    assert.equal(second.holder.holder.system, "ucpath");
    assert.equal(second.holder.expiresAt, at(TTL_MS));
    assert.equal(second.holder.generation, 1);

    const again = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-1", system: "crm", now: at(2_000), ttlMs: TTL_MS,
    });
    assert.equal(again.state, "held");

    const other = database.authority.duoCeremonyLeases.acquire({
      credentialKey: OTHER_CREDENTIAL, workerId: "person-lookup-worker-2", system: "crm", now: at(2_000), ttlMs: TTL_MS,
    });
    assert.equal(other.state, "acquired");
    database.close();
  });

  it("releases under the held generation, retires the token, and lets the next acquirer in at generation 2", async () => {
    const database = await openDatabase();
    const first = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-1", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    assert.equal(first.state, "acquired");
    if (first.state !== "acquired") return;
    const released = database.authority.duoCeremonyLeases.release({ token: first.token, now: at(20_000) });
    assert.equal(released.state, "released");
    if (released.state !== "released") return;
    assert.equal(released.lease.state, "released");
    assert.equal(released.lease.releasedAt, at(20_000));
    assert.equal(released.lease.generation, 1);
    assert.throws(() => assertDuoCeremonyLeaseToken(first.token), /retired/);

    assert.throws(
      () => database.authority.duoCeremonyLeases.release({ token: first.token, now: at(21_000) }),
      /retired/,
    );
    const second = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-2", system: "crm", now: at(22_000), ttlMs: TTL_MS,
    });
    assert.equal(second.state, "acquired");
    if (second.state !== "acquired") return;
    assert.equal(second.lease.generation, 2);
    assert.equal(second.tookOver, null);
    assert.equal(second.lease.createdAt, at(0), "one row per credential keeps its creation instant");
    database.close();
  });

  it("takes over an EXPIRED lease at the next generation and records whom it took it from", async () => {
    const database = await openDatabase();
    const first = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-1", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    assert.equal(first.state, "acquired");
    if (first.state !== "acquired") return;

    const early = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-2", system: "crm", now: at(TTL_MS - 1), ttlMs: TTL_MS,
    });
    assert.equal(early.state, "held");
    const takeover = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "person-lookup-worker-2", system: "crm", now: at(TTL_MS), ttlMs: TTL_MS,
    });
    assert.equal(takeover.state, "acquired");
    if (takeover.state !== "acquired") return;
    assert.equal(takeover.lease.generation, 2);
    assert.deepEqual(takeover.tookOver, { generation: 1, holder: { workerId: "person-lookup-worker-1", system: "ucpath" } });

    const stale = database.authority.duoCeremonyLeases.release({ token: first.token, now: at(TTL_MS + 5) });
    assert.equal(stale.state, "superseded");
    if (stale.state !== "superseded") return;
    assert.equal(stale.current.generation, 2);
    assert.equal(stale.current.holder.workerId, "person-lookup-worker-2");
    assert.throws(() => assertDuoCeremonyLeaseToken(first.token), /retired/);
    assert.deepEqual(database.authority.duoCeremonyLeases.get(CREDENTIAL), takeover.lease);
    database.close();
  });

  it("refuses a forged token, a malformed request, and a non-positive TTL", async () => {
    const database = await openDatabase();
    assert.throws(
      () => database.authority.duoCeremonyLeases.release({
        token: { credentialKey: CREDENTIAL, generation: 1, holder: { workerId: "person-lookup-worker-1", system: "ucpath" }, expiresAt: at(1) },
        now: at(1),
      }),
      /not minted by the Duo ceremony lease store/,
    );
    assert.throws(() => assertDuoCeremonyLeaseToken(undefined), /not minted/);
    assert.throws(
      () => database.authority.duoCeremonyLeases.acquire({
        credentialKey: "not-a-digest", workerId: "person-lookup-worker-1", system: "ucpath", now: at(0), ttlMs: TTL_MS,
      }),
    );
    assert.throws(
      () => database.authority.duoCeremonyLeases.acquire({
        credentialKey: CREDENTIAL, workerId: "person-lookup-worker-1", system: "ucpath", now: at(0), ttlMs: 0,
      }),
    );
    database.close();
  });
});
