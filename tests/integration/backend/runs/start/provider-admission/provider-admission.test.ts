import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { ProviderAdapter } from "../../../../../../src/workflow-kit/providers.js";
import type { ProviderAdapterOutcome } from "../../../../../../src/models/providers/providers.js";
import { ProviderOutcomeUncertainError, createAdmittedProviderClient, providerDenialDisposition, type MonotonicDeadlineScheduler } from "../../../../../../src/backend/runs/start/provider-admission.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { defaultRuntimePaths } from "../../../../../../src/backend/app/config/runtime-paths.js";
import { ConfigSchema, type ProviderBudget } from "../../../../../../src/models/config/schema.js";
import { ConfigSnapshotIdSchema, FingerprintSchema, IsoInstantSchema, ProviderAdmissionIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createDeterministicProviderHarness } from "../../../../../../src/backend/processing/providers/deterministic-provider.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, WORKER_ID, WORKFLOW_ID } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const NODE_ID = "searching";
const TASK_ID = "ocr/extract-page";
const SNAPSHOT_ID = ConfigSnapshotIdSchema.parse(UUID_4);
const CONFIG_FINGERPRINT = FingerprintSchema.parse(HASH_B);
const REQUEST_FINGERPRINT = FingerprintSchema.parse(HASH_A);
const PAYLOAD = { schemaHash: FingerprintSchema.parse(HASH_A), value: { artifact: "fixture" } };

function admissionId(index: number) {
  return ProviderAdmissionIdSchema.parse(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
}

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-provider-admission-"));
  roots.push(root);
  return join(root, "authority.sqlite");
}

function configWithBudget(budget: ProviderBudget) {
  const defaults = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  return ConfigSchema.parse({
    ...defaults,
    providers: { ...defaults.providers, geocodeCensus: budget },
  });
}

function setup(path: string, budget: ProviderBudget, at = NOW) {
  const clock = manualClock(new Date(at), 1_000);
  const database = AuthorityDatabase.open({
    path,
    busyTimeoutMs: 250,
    migrationOwner: "provider-test",
  }, clock);
  databases.push(database);
  const snapshot = {
    configSnapshotId: SNAPSHOT_ID,
    revision: 1,
    fingerprint: CONFIG_FINGERPRINT,
    capturedAt: IsoInstantSchema.parse(at),
    capturedBy: "local-operator",
    config: configWithBudget(budget),
    provenance: {},
  };
  database.authority.configSnapshots.insert(snapshot);
  database.authority.runs.enqueue(QUEUED_RUN);
  const claimed = database.authority.runs.claimNext({
    workflow: WORKFLOW_ID,
    workerId: WORKER_ID,
    now: at,
  });
  if (claimed.state !== "claimed") throw new Error("provider fixture did not claim its run");
  const validating = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: claimed.run.version,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: at, heartbeatAt: at },
    now: at,
  });
  if (validating.state !== "applied") throw new Error("provider fixture did not validate its run");
  const running = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: validating.run.version,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: {
      state: "running",
      workerId: WORKER_ID,
      claimedAt: at,
      heartbeatAt: at,
      currentNodeId: NODE_ID,
    },
    now: at,
  });
  if (running.state !== "applied") throw new Error("provider fixture did not run");
  return { database, clock, snapshot };
}

function reserveInput(id: number, now: string, maximumCostUsdMicros = 0) {
  return {
    admissionId: admissionId(id),
    execution: { runId: RUN_ID, attempt: 1, nodeId: NODE_ID, taskId: TASK_ID },
    capability: "geocode.census" as const,
    configSnapshotId: SNAPSHOT_ID,
    configFingerprint: CONFIG_FINGERPRINT,
    requestFingerprint: REQUEST_FINGERPRINT,
    estimate: { maximumCostUsdMicros },
    deadlineAt: new Date(Date.parse(now) + 10_000).toISOString(),
    leaseExpiresAt: new Date(Date.parse(now) + 20_000).toISOString(),
    now,
  };
}

function settle(database: AuthorityDatabase, id: number, now: string, costUsdMicros = 0) {
  return database.authority.providerAdmissions.settle({
    admissionId: admissionId(id),
    expectedVersion: 1,
    actualUsage: { requestCount: 1, costUsdMicros },
    adapterDisposition: "produced",
    evidence: { summary: "deterministic provider fixture", capturedAt: now },
    now,
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable provider admission repository", () => {
  it("enforces exact concurrency, UTC-minute, UTC-day request, and zero-cost edges", () => {
    const path = databasePath();
    const { database, clock } = setup(path, {
      timeoutMs: 10_000,
      concurrency: 1,
      requestsPerMinute: 1,
      dailyRequestLimit: 2,
      costLimitUsdMicros: 0,
    });
    const first = database.authority.providerAdmissions.reserve(reserveInput(1, NOW));
    assert.equal(first.state, "reserved");
    const concurrent = database.authority.providerAdmissions.reserve(reserveInput(2, NOW));
    assert.equal(concurrent.state, "denied");
    if (concurrent.admission.lifecycle.state !== "denied") throw new Error("expected denial");
    assert.equal(concurrent.admission.lifecycle.reason.code, "concurrency-exhausted");
    assert.equal(concurrent.admission.lifecycle.reason.retryAt, first.admission.lifecycle.state === "reserved"
      ? first.admission.lifecycle.leaseExpiresAt
      : undefined);
    settle(database, 1, NOW);
    const rate = database.authority.providerAdmissions.reserve(reserveInput(3, NOW));
    assert.equal(rate.state, "denied");
    if (rate.admission.lifecycle.state !== "denied") throw new Error("expected rate denial");
    assert.equal(rate.admission.lifecycle.reason.code, "rate-exhausted");
    assert.equal(rate.admission.lifecycle.reason.retryAt, "2026-07-31T17:01:00.000Z");

    clock.advanceWall(60_000);
    const minuteTwo = clock.now().toISOString();
    assert.equal(database.authority.providerAdmissions.reserve(reserveInput(4, minuteTwo)).state, "reserved");
    settle(database, 4, minuteTwo);
    clock.advanceWall(60_000);
    const daily = database.authority.providerAdmissions.reserve(reserveInput(5, clock.now().toISOString()));
    assert.equal(daily.state, "denied");
    if (daily.admission.lifecycle.state !== "denied") throw new Error("expected daily denial");
    assert.equal(daily.admission.lifecycle.reason.code, "daily-request-exhausted");
    assert.equal(daily.admission.lifecycle.reason.retryAt, "2026-08-01T00:00:00.000Z");

    const zeroCap = database.authority.providerAdmissions.reserve({
      ...reserveInput(6, clock.now().toISOString(), 1),
      requestFingerprint: FingerprintSchema.parse("c".repeat(64)),
    });
    assert.equal(zeroCap.state, "denied");
  });

  it("persists reservations across restart and expires a lease at the exact boundary without refund", () => {
    const path = databasePath();
    const budget = {
      timeoutMs: 10_000, concurrency: 1, requestsPerMinute: 10,
      dailyRequestLimit: 10, costLimitUsdMicros: 100,
    };
    const initial = setup(path, budget);
    const reserved = initial.database.authority.providerAdmissions.reserve(reserveInput(11, NOW, 70));
    if (reserved.state !== "reserved" || reserved.admission.lifecycle.state !== "reserved") {
      throw new Error("expected reserved admission");
    }
    initial.database.close();
    databases.splice(databases.indexOf(initial.database), 1);

    const reopened = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "provider-reopen" }, initial.clock);
    databases.push(reopened);
    initial.clock.setWall(new Date(reserved.admission.lifecycle.leaseExpiresAt));
    const swept = reopened.authority.providerAdmissions.sweepExpired({
      now: initial.clock.now().toISOString(),
    });
    assert.equal(swept.expired.length, 1);
    assert.equal(swept.expired[0]?.lifecycle.state, "lease-expired");
    const counter = reopened.authority.providerAdmissions.getCounter("geocode.census");
    assert.equal(counter?.activeReservations, 0);
    assert.equal(counter?.dayReservedCostUsdMicros, 70);
  });

  it("serializes competing connections, replays exact ids, and rejects divergent/config-mismatched ids", () => {
    const path = databasePath();
    const budget = {
      timeoutMs: 10_000, concurrency: 1, requestsPerMinute: 10,
      dailyRequestLimit: 10, costLimitUsdMicros: 100,
    };
    const first = setup(path, budget);
    const second = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "provider-race" }, first.clock);
    databases.push(second);
    const input = reserveInput(21, NOW, 10);
    assert.equal(first.database.authority.providerAdmissions.reserve(input).state, "reserved");
    assert.equal(second.authority.providerAdmissions.reserve(reserveInput(22, NOW, 10)).state, "denied");
    assert.equal(second.authority.providerAdmissions.reserve(input).state, "existing");
    assert.throws(
      () => second.authority.providerAdmissions.reserve({ ...input, requestFingerprint: FingerprintSchema.parse("d".repeat(64)) }),
      /reused with different content/,
    );
    assert.throws(
      () => second.authority.providerAdmissions.reserve({ ...reserveInput(23, NOW), configFingerprint: FingerprintSchema.parse("e".repeat(64)) }),
      /execution\/config identity/,
    );
  });

  it("reconciles cost down, retains unknown cost, and blocks the UTC day after an estimate breach", () => {
    const path = databasePath();
    const { database } = setup(path, {
      timeoutMs: 10_000, concurrency: 2, requestsPerMinute: 10,
      dailyRequestLimit: 10, costLimitUsdMicros: 100,
    });
    assert.equal(database.authority.providerAdmissions.reserve(reserveInput(31, NOW, 70)).state, "reserved");
    settle(database, 31, NOW, 20);
    assert.equal(database.authority.providerAdmissions.getCounter("geocode.census")?.dayReservedCostUsdMicros, 20);
    assert.equal(database.authority.providerAdmissions.reserve(reserveInput(32, NOW, 80)).state, "reserved");
    database.authority.providerAdmissions.interrupt({
      admissionId: admissionId(32),
      expectedVersion: 1,
      code: "cost-estimate-breach",
      message: "actual cost exceeded estimate",
      now: NOW,
    });
    const counter = database.authority.providerAdmissions.getCounter("geocode.census");
    assert.equal(counter?.dayReservedCostUsdMicros, 100);
    assert.equal(counter?.blockedByAdmissionId, admissionId(32));
    const blocked = database.authority.providerAdmissions.reserve(reserveInput(33, NOW, 0));
    assert.equal(blocked.state, "denied");
    if (blocked.admission.lifecycle.state !== "denied") throw new Error("expected breach denial");
    assert.equal(blocked.admission.lifecycle.reason.code, "daily-cost-exhausted");
  });
});

class ManualDeadlineScheduler implements MonotonicDeadlineScheduler {
  #deadline: (() => void) | undefined;

  schedule(_deadlineMonotonicMs: number, onDeadline: () => void) {
    this.#deadline = onDeadline;
    return Object.freeze({ cancel: () => { this.#deadline = undefined; } });
  }

  fire(): void {
    const deadline = this.#deadline;
    if (deadline === undefined) throw new Error("deadline was not scheduled");
    deadline();
  }
}

describe("admitted provider client", () => {
  function clientFixture(
    adapter: ProviderAdapter<"geocode.census">,
    repositoryOverride?: AuthorityDatabase["authority"]["providerAdmissions"],
    runSignal = new AbortController().signal,
  ) {
    const path = databasePath();
    const setupResult = setup(path, {
      timeoutMs: 10_000, concurrency: 1, requestsPerMinute: 10,
      dailyRequestLimit: 10, costLimitUsdMicros: 100,
    });
    const scheduler = new ManualDeadlineScheduler();
    const id = admissionId(91);
    const client = createAdmittedProviderClient("geocode.census", {
      execution: { runId: RUN_ID, attempt: 1, nodeId: NODE_ID, taskId: TASK_ID },
      configSnapshotId: SNAPSHOT_ID,
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshot: setupResult.snapshot,
      runSignal,
      adapters: { "geocode.census": adapter },
      repository: repositoryOverride ?? setupResult.database.authority.providerAdmissions,
      clock: setupResult.clock,
      idFactory: { next: () => id },
      deadlineScheduler: scheduler,
    });
    return { ...setupResult, scheduler, client, id };
  }

  it("settles produced output before returning it and maps retryable denial without sleeping", async () => {
    const harness = createDeterministicProviderHarness("geocode.census", [{
      kind: "return",
      estimate: { maximumCostUsdMicros: 20 },
      outcome: {
        response: { state: "produced", value: PAYLOAD },
        usage: { requestCount: 1, costUsdMicros: 7 },
        evidence: { summary: "redacted fixture", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    }]);
    const fixture = clientFixture(harness.adapter);
    assert.deepEqual(await fixture.client.call(PAYLOAD), { state: "produced", value: PAYLOAD });
    assert.equal(fixture.database.authority.providerAdmissions.get(fixture.id)?.lifecycle.state, "settled");
    assert.equal(harness.calls().length, 1);

    const disposition = providerDenialDisposition({
      code: "rate-exhausted",
      message: "minute exhausted",
      retryAt: "2026-07-31T17:01:00.000Z",
    }, {
      runId: RUN_ID,
      expectedVersion: 4,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      now: NOW,
    });
    assert.equal(disposition.state, "requeue");
    if (disposition.state === "requeue") {
      assert.equal(disposition.request.notBefore, "2026-07-31T17:01:00.000Z");
      assert.equal(disposition.request.cause, "provider-capacity");
    }
  });

  it("returns timeout even when an adapter ignores abort and durably releases the reservation", async () => {
    const adapter: ProviderAdapter<"geocode.census"> = Object.freeze({
      capability: "geocode.census",
      estimate: () => ({ maximumCostUsdMicros: 10 }),
      invoke: async () => new Promise<ProviderAdapterOutcome>(() => undefined),
    });
    const fixture = clientFixture(adapter);
    const pending = fixture.client.call(PAYLOAD);
    fixture.scheduler.fire();
    const outcome = await pending;
    assert.equal(outcome.state, "unavailable");
    if (outcome.state !== "unavailable") throw new Error("expected unavailable timeout");
    assert.equal(outcome.reason.code, "timeout");
    assert.equal(fixture.database.authority.providerAdmissions.get(fixture.id)?.lifecycle.state, "interrupted");
    assert.equal(fixture.database.authority.providerAdmissions.getCounter("geocode.census")?.activeReservations, 0);
  });

  it("performs zero adapter invocations for pre-abort and durable capacity denial", async () => {
    const harness = createDeterministicProviderHarness("geocode.census", [{
      kind: "throw", estimate: { maximumCostUsdMicros: 0 }, message: "must not invoke",
    }]);
    const preAbort = new AbortController();
    preAbort.abort(new Error("run cancelled"));
    const aborted = clientFixture(harness.adapter, undefined, preAbort.signal);
    const abortedOutcome = await aborted.client.call(PAYLOAD);
    assert.equal(abortedOutcome.state, "unavailable");
    if (abortedOutcome.state !== "unavailable") throw new Error("expected pre-abort unavailable");
    assert.equal(abortedOutcome.reason.code, "aborted");
    assert.equal(harness.calls().length, 0);
    assert.equal(aborted.database.authority.providerAdmissions.get(aborted.id)?.lifecycle.state, "denied");

    const capacityHarness = createDeterministicProviderHarness("geocode.census", [{
      kind: "throw", estimate: { maximumCostUsdMicros: 0 }, message: "must not invoke",
    }]);
    const capacity = clientFixture(capacityHarness.adapter);
    assert.equal(capacity.database.authority.providerAdmissions.reserve(reserveInput(80, NOW)).state, "reserved");
    const deniedOutcome = await capacity.client.call(PAYLOAD);
    assert.equal(deniedOutcome.state, "unavailable");
    if (deniedOutcome.state !== "unavailable") throw new Error("expected capacity unavailable");
    assert.equal(deniedOutcome.reason.code, "concurrency-exhausted");
    assert.equal(capacityHarness.calls().length, 0);
  });

  it("returns aborted when a mid-call adapter ignores its composed signal", async () => {
    const adapter: ProviderAdapter<"geocode.census"> = Object.freeze({
      capability: "geocode.census",
      estimate: () => ({ maximumCostUsdMicros: 10 }),
      invoke: async () => new Promise<ProviderAdapterOutcome>(() => undefined),
    });
    const runAbort = new AbortController();
    const fixture = clientFixture(adapter, undefined, runAbort.signal);
    const pending = fixture.client.call(PAYLOAD);
    runAbort.abort(new Error("operator cancelled run"));
    const outcome = await pending;
    assert.equal(outcome.state, "unavailable");
    if (outcome.state !== "unavailable") throw new Error("expected aborted unavailable");
    assert.equal(outcome.reason.code, "aborted");
    const admission = fixture.database.authority.providerAdmissions.get(fixture.id);
    assert.equal(admission?.lifecycle.state, "interrupted");
    if (admission?.lifecycle.state === "interrupted") assert.equal(admission.lifecycle.code, "aborted");
  });

  it("never returns remote data when durable settlement fails", async () => {
    const harness = createDeterministicProviderHarness("geocode.census", [{
      kind: "return",
      estimate: { maximumCostUsdMicros: 0 },
      outcome: {
        response: { state: "produced", value: PAYLOAD },
        usage: { requestCount: 1, costUsdMicros: 0 },
        evidence: { summary: "redacted fixture", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    }]);
    const path = databasePath();
    const setupResult = setup(path, {
      timeoutMs: 10_000, concurrency: 1, requestsPerMinute: 10,
      dailyRequestLimit: 10, costLimitUsdMicros: 100,
    });
    const repository = {
      ...setupResult.database.authority.providerAdmissions,
      settle: () => { throw new Error("injected settlement failure"); },
    };
    const scheduler = new ManualDeadlineScheduler();
    const client = createAdmittedProviderClient("geocode.census", {
      execution: { runId: RUN_ID, attempt: 1, nodeId: NODE_ID, taskId: TASK_ID },
      configSnapshotId: SNAPSHOT_ID,
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshot: setupResult.snapshot,
      runSignal: new AbortController().signal,
      adapters: { "geocode.census": harness.adapter },
      repository,
      clock: setupResult.clock,
      idFactory: { next: () => admissionId(92) },
      deadlineScheduler: scheduler,
    });
    await assert.rejects(client.call(PAYLOAD), ProviderOutcomeUncertainError);
  });

  it("durably interrupts an adapter that throws synchronously before returning a promise", async () => {
    const adapter: ProviderAdapter<"geocode.census"> = {
      capability: "geocode.census",
      estimate: () => ({ maximumCostUsdMicros: 9 }),
      invoke() { throw new Error("synchronous adapter failure"); },
    };
    const fixture = clientFixture(adapter);
    const outcome = await fixture.client.call(PAYLOAD);
    assert.equal(outcome.state, "unavailable");
    if (outcome.state !== "unavailable") throw new Error("expected unavailable adapter result");
    assert.equal(outcome.reason.code, "adapter-unavailable");
    const admission = fixture.database.authority.providerAdmissions.get(fixture.id);
    assert.equal(admission?.lifecycle.state, "interrupted");
    if (admission?.lifecycle.state === "interrupted") assert.equal(admission.lifecycle.code, "adapter-error");
    assert.equal(fixture.database.authority.providerAdmissions.getCounter("geocode.census")?.activeReservations, 0);
  });

  it("settles a strict adapter-unavailable outcome instead of treating it as produced", async () => {
    const harness = createDeterministicProviderHarness("geocode.census", [{
      kind: "return",
      estimate: { maximumCostUsdMicros: 3 },
      outcome: {
        response: {
          state: "unavailable",
          reason: { code: "adapter-unavailable", message: "fixture provider is offline" },
        },
        usage: { requestCount: 1, costUsdMicros: 1 },
        evidence: { summary: "redacted provider outage", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    }]);
    const fixture = clientFixture(harness.adapter);
    const outcome = await fixture.client.call(PAYLOAD);
    assert.equal(outcome.state, "unavailable");
    assert.equal(fixture.database.authority.providerAdmissions.get(fixture.id)?.lifecycle.state, "settled");
  });

  it("fails loud and blocks admission when measured cost exceeds the conservative estimate", async () => {
    const harness = createDeterministicProviderHarness("geocode.census", [{
      kind: "return",
      estimate: { maximumCostUsdMicros: 1 },
      outcome: {
        response: { state: "produced", value: PAYLOAD },
        usage: { requestCount: 1, costUsdMicros: 2 },
        evidence: { summary: "redacted overspend", capturedAt: IsoInstantSchema.parse(NOW) },
      },
    }]);
    const fixture = clientFixture(harness.adapter);
    await assert.rejects(fixture.client.call(PAYLOAD), /breached its conservative maximum cost estimate/);
    const admission = fixture.database.authority.providerAdmissions.get(fixture.id);
    assert.equal(admission?.lifecycle.state, "interrupted");
    assert.equal(fixture.database.authority.providerAdmissions.getCounter("geocode.census")?.blockedByAdmissionId, fixture.id);
  });

  it("strictly rejects malformed adapter outcomes and records full-reservation interruption", async () => {
    const valid = createDeterministicProviderHarness("geocode.census", [{
      kind: "throw", estimate: { maximumCostUsdMicros: 5 }, message: "unused",
    }]).adapter;
    const proxyTarget: ProviderAdapter<"geocode.census"> = {
      capability: "geocode.census",
      estimate: (request) => valid.estimate(request),
      invoke: (request, options) => valid.invoke(request, options),
    };
    const malformed = new Proxy(proxyTarget, {
      get(target, property) {
        if (property === "invoke") return async () => ({ malformed: true });
        if (property === "estimate") return (request: Parameters<typeof target.estimate>[0]) => target.estimate(request);
        if (property === "capability") return target.capability;
        throw new Error(`unexpected deterministic adapter property ${String(property)}`);
      },
    });
    const fixture = clientFixture(malformed);
    const outcome = await fixture.client.call(PAYLOAD);
    assert.equal(outcome.state, "invalid-response");
    const admission = fixture.database.authority.providerAdmissions.get(fixture.id);
    assert.equal(admission?.lifecycle.state, "interrupted");
    if (admission?.lifecycle.state === "interrupted") assert.equal(admission.lifecycle.code, "invalid-outcome");
  });
});
