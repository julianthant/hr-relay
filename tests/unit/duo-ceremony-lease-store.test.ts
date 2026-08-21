/**
 * Ref execution-and-sessions §10 (D267): the Duo ceremony lease store — one
 * ceremony at a time per CREDENTIAL, durable in authority.
 *
 * Written first (TDD): every case below failed before the repository existed.
 * The load-bearing cases are the ones a second process would reach — a second
 * acquirer is refused NAMING the holder; an expired row is taken over at the
 * next generation; a release under a superseded generation is reported rather
 * than overwriting the successor's row; and the token the store mints is the
 * ONLY thing `assertDuoCeremonyLeaseToken` accepts.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  assertDuoCeremonyLeaseToken,
  isDuoCeremonyLeaseToken,
} from "../../src/base/duo-ceremony-lease.js";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";

const CREDENTIAL = FingerprintSchema.parse("ab".repeat(32));
const OTHER_CREDENTIAL = FingerprintSchema.parse("cd".repeat(32));
const TTL_MS = 80_000;
const T0 = "2026-08-21T10:00:00.000Z";

const roots: string[] = [];
function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-duo-lease-"));
  roots.push(root);
  return AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(T0)),
  );
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

describe("duo_ceremony_leases — acquire / release / takeover", () => {
  it("acquires a free credential at generation 1 and mints the one token the helpers accept", () => {
    const database = openDatabase();
    const outcome = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-a", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    assert.equal(outcome.state, "acquired");
    if (outcome.state !== "acquired") return;
    assert.equal(outcome.lease.generation, 1);
    assert.equal(outcome.lease.holder.workerId, "worker-a");
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

  it("refuses a second acquirer while the lease is live, naming the holder", () => {
    const database = openDatabase();
    database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-a", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    const second = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-b", system: "crm", now: at(1_000), ttlMs: TTL_MS,
    });
    assert.equal(second.state, "held");
    if (second.state !== "held") return;
    assert.equal(second.holder.holder.workerId, "worker-a");
    assert.equal(second.holder.holder.system, "ucpath");
    assert.equal(second.holder.expiresAt, at(TTL_MS));
    assert.equal(second.holder.generation, 1);
    // The SAME worker re-asking is also refused: a lease is per ceremony, not per worker.
    const again = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-a", system: "crm", now: at(2_000), ttlMs: TTL_MS,
    });
    assert.equal(again.state, "held");
    // A DIFFERENT credential is a different lease.
    const other = database.authority.duoCeremonyLeases.acquire({
      credentialKey: OTHER_CREDENTIAL, workerId: "worker-b", system: "crm", now: at(2_000), ttlMs: TTL_MS,
    });
    assert.equal(other.state, "acquired");
    database.close();
  });

  it("releases under the held generation, retires the token, and lets the next acquirer in at generation 2", () => {
    const database = openDatabase();
    const first = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-a", system: "ucpath", now: at(0), ttlMs: TTL_MS,
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
    // A second release of the same token is a programming error, loud.
    assert.throws(
      () => database.authority.duoCeremonyLeases.release({ token: first.token, now: at(21_000) }),
      /retired/,
    );
    const second = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-b", system: "crm", now: at(22_000), ttlMs: TTL_MS,
    });
    assert.equal(second.state, "acquired");
    if (second.state !== "acquired") return;
    assert.equal(second.lease.generation, 2);
    assert.equal(second.tookOver, null);
    assert.equal(second.lease.createdAt, at(0), "one row per credential keeps its creation instant");
    database.close();
  });

  it("takes over an EXPIRED lease at the next generation and records whom it took it from", () => {
    const database = openDatabase();
    const first = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-a", system: "ucpath", now: at(0), ttlMs: TTL_MS,
    });
    assert.equal(first.state, "acquired");
    if (first.state !== "acquired") return;
    // One millisecond BEFORE expiry is still held.
    const early = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-b", system: "crm", now: at(TTL_MS - 1), ttlMs: TTL_MS,
    });
    assert.equal(early.state, "held");
    const takeover = database.authority.duoCeremonyLeases.acquire({
      credentialKey: CREDENTIAL, workerId: "worker-b", system: "crm", now: at(TTL_MS), ttlMs: TTL_MS,
    });
    assert.equal(takeover.state, "acquired");
    if (takeover.state !== "acquired") return;
    assert.equal(takeover.lease.generation, 2);
    assert.deepEqual(takeover.tookOver, { generation: 1, holder: { workerId: "worker-a", system: "ucpath" } });
    // The superseded holder's release is REPORTED, never written over the successor.
    const stale = database.authority.duoCeremonyLeases.release({ token: first.token, now: at(TTL_MS + 5) });
    assert.equal(stale.state, "superseded");
    if (stale.state !== "superseded") return;
    assert.equal(stale.current.generation, 2);
    assert.equal(stale.current.holder.workerId, "worker-b");
    assert.throws(() => assertDuoCeremonyLeaseToken(first.token), /retired/);
    assert.deepEqual(database.authority.duoCeremonyLeases.get(CREDENTIAL), takeover.lease);
    database.close();
  });

  it("refuses a forged token, a malformed request, and a non-positive TTL", () => {
    const database = openDatabase();
    assert.throws(
      () => database.authority.duoCeremonyLeases.release({
        token: { credentialKey: CREDENTIAL, generation: 1, holder: { workerId: "worker-a", system: "ucpath" }, expiresAt: at(1) },
        now: at(1),
      }),
      /not minted by the Duo ceremony lease store/,
    );
    assert.throws(() => assertDuoCeremonyLeaseToken(undefined), /not minted/);
    assert.throws(
      () => database.authority.duoCeremonyLeases.acquire({
        credentialKey: "not-a-digest", workerId: "worker-a", system: "ucpath", now: at(0), ttlMs: TTL_MS,
      }),
    );
    assert.throws(
      () => database.authority.duoCeremonyLeases.acquire({
        credentialKey: CREDENTIAL, workerId: "worker-a", system: "ucpath", now: at(0), ttlMs: 0,
      }),
    );
    database.close();
  });
});
