/**
 * D178 exit arm ③: **provider exhaustion is a typed `unavailable`, and cost
 * is retained conservatively.**
 *
 * The admission kernel is REAL here — a real authority database, the real
 * `provider_admissions` repository, the real budget counters — because the
 * claim being made is about durable accounting, not about a branch in the
 * service. A fake repository would prove that the service reads a field.
 *
 * Three exhaustion shapes are covered, and each one has to remain
 * distinguishable from "the advisory had nothing to say":
 *
 *   · the daily request limit is spent   → `daily-request-exhausted` + retryAt
 *   · no adapter is composed at all      → `adapter-unavailable`, no retryAt
 *   · every pool child answers exhausted → `rate-exhausted`, the pool having
 *     rotated ACROSS invocations and never made a second remote attempt under
 *     one admission
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createAdvisoryProviderClient } from "../../src/core/provider-admission.js";
import { ADVISORY_ANSWER_SCHEMA_HASH } from "../../src/domain/trust/advisory.js";
import { createDeterministicProviderHarness } from "../../src/infra/providers/deterministic-provider.js";
import { createProviderPool } from "../../src/infra/providers/provider-pool.js";
import { produceFailureTriageAdvisory } from "../../src/services/trust/advisory.js";
import {
  ADVISORY_NOW,
  MAXIMAL_FAILURE,
  VALID_TRIAGE_ADVICE,
  advisoryAdmissionIdFactory,
  immediateScheduler,
  openAdvisoryAuthority,
  producedOutcome,
  producedTriageEnvelope,
  type AdvisoryAuthorityHarness,
} from "./fixtures/advisory-fixtures.js";
import { QUEUED_RUN, RUN_ID } from "./fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function harnessFor(budget?: Parameters<typeof openAdvisoryAuthority>[0]): AdvisoryAuthorityHarness {
  const harness = openAdvisoryAuthority(budget);
  disposers.push(harness.dispose);
  return harness;
}

function clientFor(harness: AdvisoryAuthorityHarness, adapters: Record<string, unknown>) {
  const snapshot = harness.database.authority.configSnapshots.get(QUEUED_RUN.envelope.configSnapshotId);
  assert.ok(snapshot !== undefined);
  return createAdvisoryProviderClient({
    runId: RUN_ID,
    attempt: QUEUED_RUN.envelope.attempt,
    surface: "failure-triage",
    configSnapshotId: snapshot.configSnapshotId,
    configFingerprint: snapshot.fingerprint,
    configSnapshot: snapshot,
    runSignal: new AbortController().signal,
    adapters: adapters,
    repository: harness.database.authority.providerAdmissions,
    clock: harness.clock,
    idFactory: advisoryAdmissionIdFactory(),
    deadlineScheduler: immediateScheduler(),
  });
}

const EXHAUSTED = (code: string) => ({
  response: {
    state: "unavailable",
    reason: { code, message: `pool child ${code}`, retryAt: "2026-08-09T09:01:00.000Z" },
  },
  usage: { requestCount: 1, costUsdMicros: 0 },
  evidence: { summary: "exhausted child", capturedAt: ADVISORY_NOW },
});

describe("advisory provider exhaustion", () => {
  it("surfaces a spent daily budget as a typed unavailable with a retryAt", async () => {
    const harness = harnessFor({
      aiAdvisoryBudget: {
        timeoutMs: 30_000,
        concurrency: 2,
        requestsPerMinute: 10,
        dailyRequestLimit: 1,
        costLimitUsdMicros: 0,
      },
    });
    // Two scripts, one invocation: the kernel ESTIMATES before it reserves, so
    // the denied ask still costs an estimate — and never an `invoke`.
    const adapter = createDeterministicProviderHarness("ai.advisory", [
      {
        kind: "return",
        estimate: { maximumCostUsdMicros: 0 },
        outcome: producedOutcome(producedTriageEnvelope(VALID_TRIAGE_ADVICE)) as never,
      },
      {
        kind: "return",
        estimate: { maximumCostUsdMicros: 0 },
        outcome: producedOutcome(producedTriageEnvelope(VALID_TRIAGE_ADVICE)) as never,
      },
    ]);
    const client = clientFor(harness, { "ai.advisory": adapter.adapter });

    const first = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    assert.equal(first.outcome, "advisory-produced");

    // The day's ONE request is spent; the second ask is refused before any
    // remote I/O, and it says so with the code the kernel owns.
    const second = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    assert.equal(second.outcome, "unavailable");
    if (second.outcome !== "unavailable") return;
    assert.equal(second.code, "daily-request-exhausted");
    assert.ok(second.retryAt !== undefined, "a retryable exhaustion must say when");
    assert.equal(adapter.calls().length, 1, "the denied ask must never reach the adapter");

    // Durable accounting: two admissions, the second DENIED, and the counter
    // holds the day's spend rather than releasing it.
    const counter = harness.database.authority.providerAdmissions.getCounter("ai.advisory");
    assert.ok(counter !== undefined);
    assert.equal(counter.dayRequests, 1);
    const denied = harness.database.authority.providerAdmissions
      .get("00000000-0000-4000-8000-000000000002");
    assert.ok(denied !== undefined);
    assert.equal(denied.lifecycle.state, "denied");
    // The advisory arm's identity is honest about WHAT was asked and never
    // claims a node the run was not executing.
    assert.deepEqual(denied.execution, {
      runId: RUN_ID,
      attempt: QUEUED_RUN.envelope.attempt,
      surface: "failure-triage",
    });
  });

  it("surfaces an uncomposed capability as adapter-unavailable, with no retryAt", async () => {
    const harness = harnessFor();
    const client = clientFor(harness, {});
    const outcome = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    assert.equal(outcome.outcome, "unavailable");
    if (outcome.outcome !== "unavailable") return;
    assert.equal(outcome.code, "adapter-unavailable");
    assert.equal(outcome.retryAt, undefined, "a human-fixable absence must not promise a retry time");
    assert.match(outcome.reason, /ai\.advisory has no configured adapter/u);
    // Even a denial is recorded: "we never asked" is durable, not inferred.
    const denial = harness.database.authority.providerAdmissions
      .get("00000000-0000-4000-8000-000000000001");
    assert.ok(denial !== undefined);
    assert.equal(denial.lifecycle.state, "denied");
  });

  it("exhausts a whole pool one invocation at a time, never twice under one admission", async () => {
    const harness = harnessFor();
    const children = ["gemini-key1/model-a", "gemini-key2/model-a"].map((label) => {
      const child = createDeterministicProviderHarness("ai.advisory", [
        { kind: "return", estimate: { maximumCostUsdMicros: 0 }, outcome: EXHAUSTED("rate-exhausted") as never },
        { kind: "return", estimate: { maximumCostUsdMicros: 0 }, outcome: EXHAUSTED("rate-exhausted") as never },
      ]);
      return { label, harness: child, child: { label, adapter: child.adapter } };
    });
    const pool = createProviderPool("ai.advisory", children.map(({ child }) => child));
    const client = clientFor(harness, { "ai.advisory": pool });

    const first = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    const second = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    for (const outcome of [first, second]) {
      assert.equal(outcome.outcome, "unavailable");
      if (outcome.outcome === "unavailable") assert.equal(outcome.code, "rate-exhausted");
    }
    // One invocation is ONE model call: each child answered exactly once, the
    // cursor having advanced BETWEEN the two admitted asks.
    assert.deepEqual(children.map(({ harness: child }) => child.calls().length), [1, 1]);

    // Both admissions settled durably, and the conservative reservation is
    // retained: an exhausted answer still consumed the day's request.
    const counter = harness.database.authority.providerAdmissions.getCounter("ai.advisory");
    assert.ok(counter !== undefined);
    assert.equal(counter.dayRequests, 2);
    assert.equal(counter.activeReservations, 0);
    for (const id of ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]) {
      const admission = harness.database.authority.providerAdmissions.get(id);
      assert.ok(admission !== undefined);
      assert.equal(admission.lifecycle.state, "settled");
      if (admission.lifecycle.state === "settled") {
        assert.equal(admission.lifecycle.adapterDisposition, "unavailable");
      }
    }
  });

  it("never substitutes cached advice for an unavailable one", async () => {
    const harness = harnessFor();
    const adapter = createDeterministicProviderHarness("ai.advisory", [
      {
        kind: "return",
        estimate: { maximumCostUsdMicros: 0 },
        outcome: producedOutcome(producedTriageEnvelope(VALID_TRIAGE_ADVICE)) as never,
      },
      { kind: "return", estimate: { maximumCostUsdMicros: 0 }, outcome: EXHAUSTED("rate-exhausted") as never },
    ]);
    const client = clientFor(harness, { "ai.advisory": adapter.adapter });

    const produced = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    assert.equal(produced.outcome, "advisory-produced");
    const exhausted = await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE);
    assert.equal(exhausted.outcome, "unavailable");
    assert.equal("advice" in exhausted, false, "an unavailable outcome must carry no advice at all");
    assert.equal(ADVISORY_ANSWER_SCHEMA_HASH.length, 64);
  });
});
