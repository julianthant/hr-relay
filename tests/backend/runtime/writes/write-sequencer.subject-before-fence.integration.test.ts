import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { WriteSequencerContext } from "../../../../src/backend/runtime/execution/run-execution-write.js";
import {
  assertSequencerMintedMutationCapability,
  createWriteSequencer,
} from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { withBoundRunConfigFingerprint } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { duoCeremonyGatesOver } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { absentProbeEvidence, buildWriteFixtureRegistry, createWriteFixtureWorld, WRITE_FIXTURE_KEY, WRITE_FIXTURE_NODE_ID, WRITE_FIXTURE_NOW, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_WORKER_ID, WRITE_FIXTURE_WORKFLOW_ID, writeFixtureDescriptor, writeFixtureQueuedRun, writeFixtureSessionManager, writeFixtureSessions, writeFixtureTransactionNode, type WriteFixtureWorld } from "../../../support/fixtures/write-sequencer-fixtures.js";

/* ── behavioral ordering over the real sequencer ─────────────────────────── */

interface OrderingHarness {
  readonly world: WriteFixtureWorld;
  readonly database: AuthorityDatabase;
  readonly path: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly sessions: ReturnType<typeof writeFixtureSessions>;
  readonly sequencer: ReturnType<typeof createWriteSequencer>;

  readonly execute: (context: WriteSequencerContext) => Promise<unknown>;
  readonly dispose: () => void | Promise<void>;
}

async function orderingHarness(beforeConfirmedWrite?: () => Promise<void>): Promise<OrderingHarness> {
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "subject-fence-guard" },
    clock,
  );
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const world = createWriteFixtureWorld();
  const registry = buildWriteFixtureRegistry(world);
  const sessions = writeFixtureSessions(world);
  const manager = await writeFixtureSessionManager(sessions, registry, clock, duoCeremonyGatesOver(database, clock));
  const sequencer = createWriteSequencer({
    lifecycle: testRunLifecycle(database, clock),
    stores: registry,
    authority: database,
    sessions: manager,
    emitter: recordingEmitter().emitter,
    clock,
    ids: sequentialIdFactory("c"),
    scheduler: new ManualScheduler(clock),
    taskDeadlineMs: 60_000,
    operator: "local-operator",
    ...(beforeConfirmedWrite === undefined ? {} : { beforeConfirmedWrite }),
    log: recordingLogger().log
  });
  const execute = (context: WriteSequencerContext): Promise<unknown> =>
    withBoundRunConfigFingerprint(
      manager,
      context.run.envelope.configFingerprint,
      () => sequencer.executeTransaction(context),
      "headless", { runId: context.run.envelope.runId, descriptorFingerprint: context.run.envelope.contractFingerprint },
    );
  return {
    world, database, path: profile.path, clock, sessions, sequencer, execute,
    dispose: async () => {
      releaseSeededWriteOwners(database, clock.now().toISOString());
      database.close();
      await profile.close();
    },
  };
}

function runningContext(
  h: OrderingHarness,
  runInput: Record<string, unknown> = writeFixtureQueuedRun(),
  workerId = WRITE_FIXTURE_WORKER_ID,
  eid?: string,
): WriteSequencerContext {
  const now = h.clock.now().toISOString();
  assert.equal(h.database.authority.runs.enqueue(runInput).state, "inserted");
  const poolIndex = workerId === WRITE_FIXTURE_WORKER_ID ? 1 : 2;
  testWorkerPorts(h.database, h.clock, { path: h.path, descriptor: writeFixtureDescriptor, poolIndex });
  const member = h.database.authority.workerSlots.get(workerId);
  assert.ok(member);
  const claimed = h.database.authority.runs.claimNext({
    workflow: WRITE_FIXTURE_WORKFLOW_ID, workerId, now,
  });
  if (claimed.state !== "claimed") throw new Error("guard claim failed");
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const base = { workerId, claimedAt: now, heartbeatAt: now };
  const runId = claimed.run.envelope.runId;
  assert.equal(h.database.authority.runs.transition({
    runId, expectedVersion: claimed.run.version, claim,
    lifecycle: { state: "validating", ...base }, now,
  }).state, "applied");
  const running = h.database.authority.runs.transition({
    runId, expectedVersion: claimed.run.version + 1, claim,
    lifecycle: { state: "running", ...base, currentNodeId: WRITE_FIXTURE_NODE_ID }, now,
  });
  if (running.state !== "applied") throw new Error("guard running transition failed");
  const inputEid = eid ?? (runInput as { input: { parsed: { value: { eid: string } } } }).input.parsed.value.eid;
  return {
    descriptor: writeFixtureDescriptor,
    node: writeFixtureTransactionNode(writeFixtureDescriptor),
    run: running.run,
    claim: claim as unknown as WriteSequencerContext["claim"],
    scope: { input: { eid: inputEid }, outputs: {} },
    dryRun: false,
    signal: new AbortController().signal,
  };
}

describe("prepare-end < subject-observed < fence-commit < mutation-call", () => {
  it("refuses the submit before the fence when the worker log flush times out", async () => {
    const h = await orderingHarness(() => Promise.reject(new Error("worker-log-flush-deadline")));
    try {
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      await assert.rejects(h.execute(runningContext(h)), /worker-log-flush-deadline/u);
      assert.equal(h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY), undefined);
      assert.ok(!h.world.events.some(event => event.startsWith("commit-click")));
    } finally { await h.dispose(); }
  });

  it("orders the four events on one lease and binds the capability to the fenced proof digest", async () => {
    const h = await orderingHarness();
    try {
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      h.world.onSubjectRead = () => {
        assert.equal(
          h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
          undefined,
          "the subject is observed BEFORE any fence exists",
        );
      };
      h.world.onCommitClick = () => {
        const fenced = h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
        assert.ok(fenced && fenced.status === "attempting", "the fence is durable BEFORE the click");
        // The minted capability is bound to the exact fenced proof digest.
        assertSequencerMintedMutationCapability(h.world.lastCapability, {
          intentGeneration: fenced.generation,
          bindingDigest: fenced.bindingProofDigest,
        });
      };
      await h.execute(runningContext(h));
      assert.deepEqual(h.world.events, [
        "probe",
        "prepare",
        `subject-read:${WRITE_FIXTURE_OBSERVATION}`,
        "commit-click:ucpath.write-fixture.save-submit",
      ]);
    } finally {
      await h.dispose();
    }
  });

  for (const [name, mutate] of [
    ["mismatch", (world: WriteFixtureWorld) => { world.subjectEid = "10899999"; }],
    ["unknown/unreadable", (world: WriteFixtureWorld) => { world.subjectReadThrows = new Error("stale element"); }],
    ["missing observation surface", (world: WriteFixtureWorld) => { world.omitDriverRead = true; }],
  ] as const) {
    it(`${name} produces zero fence, zero click, and a poisoned page`, async () => {
      const h = await orderingHarness();
      try {
        h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
        mutate(h.world);
        await assert.rejects(h.execute(runningContext(h)));
        assert.equal(h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY), undefined);
        assert.ok(!h.world.events.some((event) => event.startsWith("commit-click")));
        assert.deepEqual(h.sessions.closeReasons(), ["poisoned"]);
      } finally {
        await h.dispose();
      }
    });
  }

  it("binds each of two alternating EIDs through one pooled page to its own digest", async () => {
    const h = await orderingHarness();
    try {
      const otherEid = "10867890";
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
      await h.execute(runningContext(h));
      const first = h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY);
      assert.ok(first && first.status === "committed");

      // Same worker pool, a different person stages next; the probe's absent
      // evidence must bind the OTHER key's digest or the sequencer refuses it.
      h.world.subjectEid = otherEid;
      const otherEvidence = absentProbeEvidence(WRITE_FIXTURE_NOW);
      otherEvidence.evidence.idempotencyKeyDigest = deriveIdempotencyKeyDigest(
        "ucpath", `${otherEid}|fixture-termination`);
      h.world.probeResults.push(otherEvidence);
      const second = await h.execute(runningContext(
        h,
        writeFixtureQueuedRun({
          runId: "55555555-5555-4555-8555-555555555555",
          itemId: "66666666-6666-4666-8666-666666666666",
        }),
        "write-fixture-worker-2",
        otherEid,
      ));
      assert.equal((second as { disposition: string }).disposition, "committed");
      const secondIntent = h.database.authority.writeIntents.findByPermanentKey(
        "ucpath", `${otherEid}|fixture-termination`);
      assert.ok(secondIntent && secondIntent.status === "committed");
      assert.ok(first.status === "committed" && secondIntent.status === "committed");
      assert.notEqual(
        first.bindingProof.kind === "subject-match" ? first.bindingProof.expected.bindingDigest : undefined,
        secondIntent.bindingProof.kind === "subject-match" ? secondIntent.bindingProof.expected.bindingDigest : undefined,
        "each EID fenced under its OWN subject digest",
      );
    } finally {
      await h.dispose();
    }
  });

  it("rejects a forged or rebound mutation capability at the driver seam", () => {
    assert.throws(
      () => assertSequencerMintedMutationCapability({ intentGeneration: 1, bindingDigest: "a".repeat(64) }),
      /not minted by the fenced write sequencer/,
    );
  });
});
