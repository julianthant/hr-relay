import { createLoginContractTestWorld } from "../../../support/helpers/backend/login-contract-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { DuoCeremonyLeaseToken } from "../../../../src/workflow-kit/duo-ceremony-lease.js";
import { duoCeremonyGatesOver } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";

const {WORKER_A, RUN_FINGERPRINT, SYSTEM, NEED, T0, recipeFactory, managerFor, sharedAuthority, leaseRow, cleanup } = createLoginContractTestWorld();

afterEach(cleanup);

describe("two workers, one credential, one ceremony at a time", () => {

  it("recovers from ONE Duo terminal refusal on a fresh profile under the SAME lease generation", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = await sharedAuthority(clock);
    const tokens: DuoCeremonyLeaseToken[] = [];
    let refusalsLeft = 1;
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (token, context) => {
        tokens.push(token);
        if (refusalsLeft > 0) {
          refusalsLeft -= 1;
          throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
        }
      },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    const result = await manager.withDriver(NEED, "prod", new AbortController().signal, async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(a.opens(), 2, "the burned context was replaced by a fresh one");
    assert.equal(a.closes(), 1, "the burned context was closed with proof before the directory was touched");
    assert.deepEqual(a.discards(), [{
      workerId: WORKER_A, system: SYSTEM, instance: "prod", configFingerprint: RUN_FINGERPRINT, browserMode: "headless",
    }]);
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], tokens[1], "the retry ran under the very token the first ceremony held");
    assert.equal(tokens[0]?.generation, 1);
    assert.equal(leaseRow(database).generation, 1, "no release and re-acquire happened between the two attempts");
    assert.equal(leaseRow(database).state, "released");
    await manager.closeAll("worker-stop");
  });

  it("fails loud naming the profile directory on the SECOND refusal, and releases the lease", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = await sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (_token, context) => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
      },
    });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Duo refused the WebAuthn assertion AGAIN on a freshly created profile at \/tmp\/fixture-profiles\/person-lookup-worker-1\/ucpath/);
        assert.match(error.message, /not deleted a third time/);
        assert.ok(error.cause instanceof DuoTerminalRefusalError);
        return true;
      },
    );
    assert.equal(a.discards().length, 1, "the directory was recreated exactly once");
    assert.equal(a.opens(), 2);
    assert.equal(a.closes(), 2, "both burned contexts were closed with proof");
    assert.equal(leaseRow(database).generation, 1);
    assert.equal(leaseRow(database).state, "released", "the lease is released after the second refusal");
  });

  it("refuses the recovery by name when the factory cannot discard a profile, and releases the lease", async () => {
    const clock = manualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const database = await sharedAuthority(clock);
    const a = recipeFactory(WORKER_A, {
      onCeremony: async (_token, context) => {
        throw new DuoTerminalRefusalError(SYSTEM, "Duo REFUSED the WebAuthn assertion (fixture)", context.page.url());
      },
    }, { withDiscard: false });
    const manager = managerFor(WORKER_A, a.factory, clock, scheduler, duoCeremonyGatesOver(database, clock, scheduler));
    await assert.rejects(
      manager.withDriver(NEED, "prod", new AbortController().signal, async () => "never"),
      /cannot discard the burned browser profile \(no discardProfile\)/,
    );
    assert.equal(a.opens(), 1, "no retry without a fresh profile");
    assert.equal(a.closes(), 1);
    assert.equal(leaseRow(database).state, "released");
  });
});
