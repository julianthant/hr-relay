// Session replacement is authored or identity-forced and requires proven closure before opening.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import type { WorkerSessionEvent } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import {
  healthyUcpathDriver,
  sessionFactoryHarness,
  sessionManagerFor,
} from "../../../support/helpers/phase1f-executor-harness.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const RUN_FINGERPRINT = FingerprintSchema.parse(QUEUED_RUN.envelope.configFingerprint);
const OTHER_FINGERPRINT = FingerprintSchema.parse("9".repeat(64));
const UCPATH_REUSE = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
const SIGNAL = new AbortController().signal;

describe("fresh session boundary", () => {

  it("never mints a boundary for repeated reuse-worker needs", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const events: WorkerSessionEvent[] = [];
    const sessions = await sessionManagerFor(
      harness,
      manualClock(new Date("2026-08-03T09:00:00.000Z")),
      (event) => events.push(event),
    );
    for (let lease = 0; lease < 3; lease += 1) {
      await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => lease);
    }
    assert.equal(harness.opens("ucpath"), 1, "reuse must not reopen");
    assert.deepEqual(harness.closeReasons(), [], "reuse must not close");
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close"),
      [],
      "no boundary may be inferred from repetition",
    );
  });

  it("closes with proof before the replacement starts on an authored fresh need", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const events: WorkerSessionEvent[] = [];
    const sessions = await sessionManagerFor(
      harness,
      manualClock(new Date("2026-08-03T09:00:00.000Z")),
      (event) => events.push(event),
    );
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver({ ...UCPATH_REUSE, session: "fresh" }, "prod", SIGNAL, async () => "second");

    assert.deepEqual(
      harness.trace().map((entry) => entry.kind),
      ["open", "close", "open"],
      "the old resource must be closed BEFORE the replacement is opened",
    );
    assert.deepEqual(harness.closeReasons(), ["fresh-boundary"]);
    const [firstOpen, close, secondOpen] = harness.trace();
    assert.equal(close?.kind === "close" ? close.sessionId : undefined, firstOpen?.sessionId);
    assert.notEqual(secondOpen?.sessionId, firstOpen?.sessionId);

    const observed = events.filter((event) => event.type !== "browser-session:reset");
    assert.deepEqual(observed.map((event) => event.type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ], "close must be emitted between the two starts");
  });

  it("forces the same proven boundary when the reuse identity drifts", async () => {
    const harness = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver() });
    const events: WorkerSessionEvent[] = [];
    const sessions = await sessionManagerFor(
      harness,
      manualClock(new Date("2026-08-03T09:00:00.000Z")),
      (event) => events.push(event),
    );
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first-run");
    assert.equal(RUN_FINGERPRINT === OTHER_FINGERPRINT, false);
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "second-run");

    assert.deepEqual(harness.trace().map((entry) => entry.kind), ["open", "close", "open"]);
    assert.deepEqual(harness.closeReasons(), ["fresh-boundary"]);
    assert.equal(harness.logins(), 2, "the replacement must authenticate for itself");
    assert.deepEqual(
      events.filter((event) => event.type !== "browser-session:reset").map((event) => event.type),
      ["browser-session:start", "browser-session:close", "browser-session:start"],
    );
  });
});
