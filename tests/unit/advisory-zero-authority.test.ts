/**
 * D178 exit arm ④: **zero authority edge.**
 *
 * `ai-advisory-no-authority` proves the STRUCTURAL half — the advisory module
 * graph cannot reach a run transition, the command kernel, terminal
 * authority, the write sequencer or any durable trust writer. This file proves
 * the BEHAVIOURAL half over a real authority database, which is the half a
 * module-graph guard cannot make: that a whole advisory round trip — produced,
 * refused and unavailable — leaves every authority family except provider
 * admission byte-identical.
 *
 * The one durable footprint an advisory is ALLOWED is its
 * `provider_admissions` row and the capability counter beside it, because
 * D112 requires every provider call to be budgeted and there is no exemption
 * for a read. That row records who spent the budget; it transitions nothing.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { createAdvisoryProviderClient } from "../../src/core/provider-admission.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import { ADVISORY_ANSWER_SCHEMA_HASH } from "../../src/domain/trust/advisory.js";
import { createDeterministicProviderHarness } from "../../src/infra/providers/deterministic-provider.js";
import type { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
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
} from "./fixtures/advisory-fixtures.js";
import { QUEUED_RUN, RUN_ID } from "./fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/**
 * Every authority family an advisory must not touch, read through the SAME
 * repositories production reads them through. `providerAdmissions` is
 * deliberately absent: it is the metering an advisory is REQUIRED to go
 * through, and D112 grants no read an exemption from it.
 */
function snapshotAuthority(database: AuthorityDatabase): readonly string[] {
  const { authority } = database;
  const workflowId = QUEUED_RUN.envelope.workflow;
  const itemId = QUEUED_RUN.envelope.itemId;
  return [
    `run=${canonicalJsonStringify((authority.runs.get(RUN_ID) ?? null))}`,
    `failures=${String(authority.failures.listByRun(RUN_ID).length)}`,
    `checkpoints=${String(authority.runCheckpoints.listByItem(workflowId, itemId).length)}`,
    `writeIntents=${String(authority.writeIntents.listByRun(RUN_ID).length)}`,
    `receipt=${String(authority.evidenceReceipts.findByRun(RUN_ID) !== undefined)}`,
    `bundles=${String(authority.diagnosticBundles.listByRun(RUN_ID).length)}`,
    `dependencies=${String(authority.dependencies.listByParentRun(RUN_ID).length)}`,
    `knowledge=${String(authority.knowledgeRecords.list().length)}`,
    `notifications=${String(authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID).length)}`,
    `captureSessions=${String(authority.captureSessions.listActive().length)}`,
  ];
}

describe("advisory zero authority edge", () => {
  it("changes nothing outside provider admission across produced, refused and unavailable", async () => {
    const harness = openAdvisoryAuthority();
    disposers.push(harness.dispose);
    const { database } = harness;

    const before = snapshotAuthority(database);
    const runBefore = database.authority.runs.get(RUN_ID);
    assert.ok(runBefore !== undefined);

    const adapter = createDeterministicProviderHarness("ai.advisory", [
      // ① produced
      {
        kind: "return",
        estimate: { maximumCostUsdMicros: 0 },
        outcome: producedOutcome(producedTriageEnvelope(VALID_TRIAGE_ADVICE)) as never,
      },
      // ② a schema-violating answer → invalid-response
      {
        kind: "return",
        estimate: { maximumCostUsdMicros: 0 },
        outcome: producedOutcome(producedTriageEnvelope({ headline: "only a headline" })) as never,
      },
      // ③ exhausted → unavailable
      {
        kind: "return",
        estimate: { maximumCostUsdMicros: 0 },
        outcome: {
          response: {
            state: "unavailable",
            reason: { code: "rate-exhausted", message: "spent", retryAt: "2026-08-09T09:01:00.000Z" },
          },
          usage: { requestCount: 1, costUsdMicros: 0 },
          evidence: { summary: "exhausted", capturedAt: ADVISORY_NOW },
        } as never,
      },
    ]);
    const snapshot = database.authority.configSnapshots.get(QUEUED_RUN.envelope.configSnapshotId);
    assert.ok(snapshot !== undefined);
    const client = createAdvisoryProviderClient({
      runId: RUN_ID,
      attempt: QUEUED_RUN.envelope.attempt,
      surface: "failure-triage",
      configSnapshotId: snapshot.configSnapshotId,
      configFingerprint: snapshot.fingerprint,
      configSnapshot: snapshot,
      runSignal: new AbortController().signal,
      adapters: { "ai.advisory": adapter.adapter },
      repository: database.authority.providerAdmissions,
      clock: harness.clock,
      idFactory: advisoryAdmissionIdFactory(),
      deadlineScheduler: immediateScheduler(),
    });

    const outcomes = [
      await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE),
      await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE),
      await produceFailureTriageAdvisory({ clock: harness.clock, client }, MAXIMAL_FAILURE),
    ];
    assert.deepEqual(
      outcomes.map((outcome) => outcome.outcome),
      ["advisory-produced", "invalid-response", "unavailable"],
    );

    // The run row is byte-identical: same version, same lifecycle, nothing
    // stamped, nothing claimed, nothing terminalized.
    const runAfter = database.authority.runs.get(RUN_ID);
    assert.equal(canonicalJsonStringify(runAfter as never), canonicalJsonStringify(runBefore as never));

    // …and every other authority family the advisory must not touch is
    // exactly as it was.
    assert.deepEqual(snapshotAuthority(database), before);

    // The one allowed footprint is present and correct: three settled
    // admissions and the capability counter that budgeted them.
    for (const suffix of ["001", "002", "003"]) {
      const admission = database.authority.providerAdmissions
        .get(`00000000-0000-4000-8000-000000000${suffix}`);
      assert.ok(admission !== undefined, `admission ${suffix} must exist`);
      assert.equal(admission.lifecycle.state, "settled");
    }
    const counter = database.authority.providerAdmissions.getCounter("ai.advisory");
    assert.ok(counter !== undefined);
    assert.equal(counter.dayRequests, 3);
  });

  it("cannot be handed anything that writes: the producer's whole surface is a clock and a client", async () => {
    // The type-level claim, executed. `produceFailureTriageAdvisory` accepts
    // exactly these two dependencies, so a caller cannot pass it a store even
    // by accident — and the advice it returns is a plain value with no
    // command, action or transition on it.
    const scripted = {
      capability: "ai.advisory" as const,
      call: () => Promise.resolve({
        state: "produced",
        value: {
          schemaHash: ADVISORY_ANSWER_SCHEMA_HASH,
          value: producedTriageEnvelope(VALID_TRIAGE_ADVICE),
        },
      } as never),
    };
    const outcome = await produceFailureTriageAdvisory(
      { clock: { now: () => new Date(ADVISORY_NOW) } as never, client: scripted },
      MAXIMAL_FAILURE,
    );
    assert.equal(outcome.outcome, "advisory-produced");
    if (outcome.outcome !== "advisory-produced") return;
    // A strict object with no retryability, no remediation kind, no command
    // and no run reference: there is nothing on it a caller could mistake for
    // an instruction to authority.
    assert.deepEqual(
      Object.keys(outcome.advice).sort(),
      ["checks", "confidence", "explanation", "headline"],
    );
    assert.equal("runId" in outcome.advice, false);
    assert.equal("transient" in outcome.advice, false);
    assert.equal("command" in outcome.advice, false);
  });
});
