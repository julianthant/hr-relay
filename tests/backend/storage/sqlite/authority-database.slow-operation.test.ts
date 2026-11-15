import assert from "node:assert/strict";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock, type Clock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const AT = new Date("2026-11-14T12:00:00.000Z");
type SlowCall = Readonly<{ name: string; durationMs: number }>;

describe("slow storage operations", () => {
  let profile: Awaited<ReturnType<typeof createBoundProfileFixture>>;
  let database: AuthorityDatabase | undefined;

  beforeAll(async () => { profile = await createBoundProfileFixture(); });
  afterEach(() => { database?.close(); database = undefined; });
  afterAll(async () => { await profile.close(); });

  function open(hook?: (operation: SlowCall) => void, clock: Clock = manualClock(AT)): AuthorityDatabase {
    database = AuthorityDatabase.open(profile.admission, {
      path: profile.path, busyTimeoutMs: 250, migrationOwner: "slow-operation",
    }, clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission), hook);
    return database;
  }

  it("reports an outermost write only when it takes more than 50 ms", () => {
    const seen: SlowCall[] = [];
    const clock = manualClock(AT);
    const authority = open(operation => { seen.push(operation); }, clock);
    assert.equal(authority.withAuthorityTransaction(() => "fast"), "fast");
    assert.equal(authority.withAuthorityTransaction(() => { clock.advanceMonotonic(50); return "edge"; }), "edge");
    assert.deepEqual(seen, []);
    assert.equal(authority.withAuthorityTransaction(() => { clock.advanceMonotonic(51); return "slow"; }), "slow");
    assert.deepEqual(seen, [{ name: "authority-transaction", durationMs: 51 }]);
  });

  it("reports an outermost read snapshot only when it takes more than 50 ms", () => {
    const seen: SlowCall[] = [];
    const clock = manualClock(AT);
    const authority = open(operation => { seen.push(operation); }, clock);
    assert.equal(authority.withAuthorityReadSnapshot(() => "fast"), "fast");
    assert.equal(authority.withAuthorityReadSnapshot(() => { clock.advanceMonotonic(50); return "edge"; }), "edge");
    assert.deepEqual(seen, []);
    assert.equal(authority.withAuthorityReadSnapshot(() => { clock.advanceMonotonic(51); return "slow"; }), "slow");
    assert.deepEqual(seen, [{ name: "read-snapshot", durationMs: 51 }]);
  });

  it("reports a nested transaction or snapshot only as part of the outermost write", () => {
    const seen: SlowCall[] = [];
    const clock = manualClock(AT);
    const authority = open(operation => { seen.push(operation); }, clock);
    const result = authority.withAuthorityTransaction(() => {
      clock.advanceMonotonic(10);
      assert.equal(authority.withAuthorityTransaction(() => { clock.advanceMonotonic(51); return "inner"; }), "inner");
      assert.equal(authority.withAuthorityReadSnapshot(() => { clock.advanceMonotonic(5); return "snap"; }), "snap");
      return "outer";
    });
    assert.equal(result, "outer");
    assert.deepEqual(seen, [{ name: "authority-transaction", durationMs: 66 }]);
  });

  it("keeps the transaction result and error when the hook throws", () => {
    const clock = manualClock(AT);
    const authority = open(() => { throw new Error("slow-hook-failed"); }, clock);
    assert.equal(authority.withAuthorityTransaction(() => { clock.advanceMonotonic(51); return "kept"; }), "kept");
    assert.throws(() => authority.withAuthorityTransaction(() => {
      clock.advanceMonotonic(51);
      throw new Error("txn-failed");
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "txn-failed");
      return true;
    });
    assert.equal(authority.withAuthorityReadSnapshot(() => { clock.advanceMonotonic(51); return "read"; }), "read");
    assert.throws(() => authority.withAuthorityReadSnapshot(() => {
      clock.advanceMonotonic(51);
      throw new Error("read-failed");
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "read-failed");
      return true;
    });
  });

  it("does not report a transaction the hook itself starts", () => {
    const seen: SlowCall[] = [];
    const clock = manualClock(AT);
    const held: { authority?: AuthorityDatabase } = {};
    held.authority = open(operation => {
      seen.push(operation);
      held.authority?.withAuthorityTransaction(() => { clock.advanceMonotonic(80); });
      held.authority?.withAuthorityReadSnapshot(() => "reentered");
    }, clock);
    const authority = held.authority;
    assert.ok(authority);
    assert.equal(authority.withAuthorityTransaction(() => { clock.advanceMonotonic(51); return "outer"; }), "outer");
    assert.deepEqual(seen, [{ name: "authority-transaction", durationMs: 51 }]);
  });

  it("reports an outermost projection write and not the snapshot it opens first", () => {
    const seen: SlowCall[] = [];
    const base = manualClock(AT);
    const armed = { on: false };
    const clock: Clock = {
      now() {
        const current = base.now();
        if (armed.on) base.advanceMonotonic(51);
        return current;
      },
      nowMs: () => base.nowMs(),
      monotonicMs: () => base.monotonicMs(),
      todayLocal: () => base.todayLocal(),
      timeOfDayCode: (at?: Date) => base.timeOfDayCode(at),
      fiscalYear: (at?: Date) => base.fiscalYear(at),
    };
    const authority = open(operation => { seen.push(operation); }, clock);
    authority.registerRunSearchDeclarations([]);
    assert.equal(seen.length, 0);
    armed.on = true;
    authority.registerRunSearchDeclarations([]);
    const [event] = seen;
    assert.ok(event);
    assert.equal(event.name, "projection-transaction");
    assert.ok(event.durationMs > 50);
  });
});
