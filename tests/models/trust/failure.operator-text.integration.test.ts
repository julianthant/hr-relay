import { testWorkerLifetime } from "../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildExplainRunView, renderExplainRun } from "../../../src/backend/runs/explain/explain-run.js";
import { buildReceiptFailureSection } from "../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { inboxProjection } from "../../../src/dashboard/state/inbox-wiring-adapter.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { NotificationWireSchema } from "../../../src/models/dashboard/projection.js";
import { FailureRecordSchema, projectFailureForOperator } from "../../../src/models/trust/failure.js";
import { RunRecordSchema, type RunRecord } from "../../../src/models/run/record.js";
import { projectNotificationTrigger } from "../../../src/rules/notifications/notification-triggers.js";
import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { claimEventOf, failureRecordOf, queuedEventOf, taskEventsOf, traceOf, uuidOf, DAY, type DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { createRunQueueProjectionTestWorld } from "../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { trustWorld } from "../../support/helpers/backend/trust-authority-fixture.js";

const RAW = "[ucpath/search-person-org] DUO_TERMINAL_REFUSAL: Duo refused the WebAuthn assertion for subject 10812345";
const CATALOG = ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text;
const UNREGISTERED = ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text;
const { world, runRecordOf, cleanup } = createRunQueueProjectionTestWorld();
const trusts: Awaited<ReturnType<typeof trustWorld>>[] = [];

afterEach(async () => {
  await cleanup();
  for (const trust of trusts.splice(0).reverse()) await trust.dispose();
});

function duoFailure(seed = 4) {
  return FailureRecordSchema.parse({
    ...failureRecordOf({ seed, code: "DUO_TERMINAL_REFUSAL" }),
    summary: RAW,
    causeChain: [{ code: "DUO_TERMINAL_REFUSAL", summary: RAW, role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: `Investigate and correct at the source: ${RAW}` }],
  });
}

function seedFailedQueue(w: DashboardWorld, failure: ReturnType<typeof duoFailure>, run?: RunRecord): void {
  const seed = 4;
  queuedEventOf(w, { seed });
  claimEventOf(w, seed);
  taskEventsOf(w, seed, "searching", "failed");
  w.writer.emit({
    t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
    runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed),
    outcome: "failed", failureId: failure.failureId,
  });
  w.authority.put(run ?? runRecordOf({
    seed,
    lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:12:00.000Z", failureId: failure.failureId },
    version: 3,
  }));
  w.authority.failures.set(String(failure.failureId), failure);
}

function queueRow(w: DashboardWorld, runId: string) {
  const row = w.projection.buildDashboardDayWire(DAY).queueSurfaces.find(surface => surface.runId === runId);
  assert.ok(row);
  return row;
}

function protect(run: RunRecord): RunRecord {
  return RunRecordSchema.parse({
    ...run,
    input: {
      ...run.input,
      parsed: {
        ...run.input.parsed,
        protectedBindings: [{
          kind: "test-data-local",
          inputPath: "emplId",
          name: "personLookupCanaryEid",
          sourceId: "10000000-0000-4000-8000-000000000099",
        }],
      },
    },
  });
}

describe("operator failure text", () => {
  it("shows the catalog sentence on the queue, in the failure section, and on the failure notification", async () => {
    const failure = duoFailure();
    const w = await world();
    seedFailedQueue(w, failure);
    const row = queueRow(w, failure.runId);
    assert.deepEqual(row.liveMessage, { state: "present", value: CATALOG });
    assert.equal(JSON.stringify(row.liveMessage).includes("10812345"), false);

    const trust = await trustWorld();
    trusts.push(trust);
    const created = trust.create(401);
    const now = trust.world.clock.now().toISOString();
    const member = trust.database.authority.workerSlots.get(trust.workerId); assert.ok(member);
    const workerLifetime = testWorkerLifetime(trust.database, created.envelope.workflow, member.poolIndex).workerLifetime;
    const claimed = trust.database.authority.runs.claimNext({ workerLifetime, workflow: created.envelope.workflow, workerId: trust.workerId, now });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("fixture claim failed");
    const claim = { workerId: trust.workerId, claimGeneration: claimed.run.claimGeneration };
    const validating = trust.database.authority.runs.transition({
      runId: created.envelope.runId, expectedVersion: claimed.run.version, claim, now,
      lifecycle: { state: "validating", workerId: trust.workerId, workerLifetime, claimedAt: now, heartbeatAt: now },
    });
    assert.equal(validating.state, "applied");
    if (validating.state !== "applied") throw new Error("fixture validation failed");
    const stored = FailureRecordSchema.parse({
      ...failure,
      failureId: uuidOf(402),
      runId: created.envelope.runId,
      traceId: created.envelope.traceId,
      attempt: created.envelope.attempt,
      workflowId: created.envelope.workflow,
      fingerprint: HASH_A,
    });
    trust.database.terminalizeFailure(personLookupDescriptor, {
      failure: stored,
      authorization: {
        kind: "failed", runId: created.envelope.runId, workflowId: created.envelope.workflow,
        attempt: created.envelope.attempt, descriptorVersion: created.envelope.descriptorVersion,
        contractFingerprint: created.envelope.contractFingerprint, expectedVersion: validating.run.version,
        claim, authorizedAt: now, failureId: stored.failureId,
      },
    });
    const section = buildReceiptFailureSection(trust.deps, created.envelope.runId, "failure");
    if (section.section !== "failure" || section.payload.state !== "available") throw new Error("failure section missing");
    assert.equal(section.payload.value.summary, CATALOG);
    assert.equal(section.payload.value.summary.includes("10812345"), false);
    assert.equal(trust.database.authority.failures.get(stored.failureId)?.summary, RAW);

    const notification = projectNotificationTrigger({
      kind: "run-failed", runId: failure.runId, workflowId: failure.workflowId,
      failureId: failure.failureId, failureFingerprint: failure.fingerprint, code: failure.code,
    });
    assert.equal(notification.summary, CATALOG);
    assert.equal(notification.summary.includes(failure.runId), false);
    assert.equal(notification.summary.includes("10812345"), false);
    const wire = NotificationWireSchema.parse({
      kind: "notification", notificationId: failure.failureId, actorId: "local-operator", channel: "ping",
      count: 1, publicationId: "a".repeat(64), severity: "error", title: "Run failed", summary: notification.summary,
      state: "unread", readState: "unread", trigger: "failed", revision: 1, occurredAt: "2026-08-03T17:12:00.000Z",
      context: { state: "available", subject: "Exact subject", workflow: "Person Lookup" },
      sourceEvent: { state: "available", kind: "run-failed" },
      link: { kind: "failure", runId: failure.runId, failureId: failure.failureId },
    });
    const inbox = inboxProjection([wire], "2026-08-03T17:20:00.000Z");
    assert.equal(inbox.state.state, "ready");
    if (inbox.state.state !== "ready") throw new Error("inbox unavailable");
    assert.equal(inbox.state.items[0]?.detail, CATALOG);
    assert.equal(inbox.state.items[0]?.detail.includes("10812345"), false);

    const run = runRecordOf({
      seed: 4,
      lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:12:00.000Z", failureId: failure.failureId },
      version: 3,
    });
    const view = buildExplainRunView({ run, checkpoints: [], writes: [], failure, nodeIds: [], dependencies: [] });
    assert.equal(view.failure.state, "present");
    if (view.failure.state !== "present") throw new Error("explain failure missing");
    assert.equal(view.failure.value.summary, RAW);
    assert.equal(renderExplainRun(view).includes(RAW), true);
  });

  it("shows no protected value for a protected-input run, and an absent catalog code uses the unregistered sentence", async () => {
    const failure = duoFailure();
    const w = await world();
    const run = protect(runRecordOf({
      seed: 4,
      lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-08-03T17:12:00.000Z", failureId: failure.failureId },
      version: 3,
    }));
    seedFailedQueue(w, failure, run);
    const row = queueRow(w, failure.runId);
    assert.deepEqual(row.liveMessage, { state: "present", value: CATALOG });
    assert.equal(JSON.stringify(row).includes("10812345"), false);
    const projected = projectFailureForOperator(failure, true);
    assert.equal(JSON.stringify(projected).includes("10812345"), false);
    assert.equal(JSON.stringify(projected).includes(RAW), false);
    assert.equal(projected.summary, CATALOG);
    const explained = buildExplainRunView({ run, checkpoints: [], writes: [], failure, nodeIds: [], dependencies: [] });
    assert.equal(renderExplainRun(explained).includes("10812345"), false);
    assert.equal(renderExplainRun(explained).includes(RAW), false);

    const unknown = FailureRecordSchema.parse({
      ...failureRecordOf({ seed: 8, code: "CRM_UNAVAILABLE" }),
      summary: RAW,
    });
    assert.equal(projectFailureForOperator(unknown).summary, UNREGISTERED);
    assert.equal(projectFailureForOperator(unknown).summary.includes(RAW), false);
    assert.equal(projectNotificationTrigger({
      kind: "run-failed", runId: unknown.runId, workflowId: unknown.workflowId,
      failureId: unknown.failureId, failureFingerprint: unknown.fingerprint, code: unknown.code,
    }).summary, UNREGISTERED);
  });
});
