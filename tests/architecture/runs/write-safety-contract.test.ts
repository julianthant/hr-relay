import { fenceWriteFixture } from "../../support/helpers/write-fence-fixture.js";
import { releaseSeededWriteOwners } from "../../support/helpers/timeline-write-fixture.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-authority-reason.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { testRunContinuation, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { createWriteRecoveryService } from "../../../src/backend/runtime/writes/write-recovery.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import {
  RuntimeTaskContractDefinitionSchema,
  type AnyCommitTaskContract,
} from "../../../src/models/task/task-contract.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { probeVerdictSchema } from "../../../src/rules/write-safety/write-safety.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";
import { ManualScheduler, recordingLogger } from "../../support/helpers/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
  absentProbeEvidence,
  buildWriteFixtureRegistry,
  createWriteFixtureWorld,
  WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_KEY,
  WriteFixtureCommit,
  WriteFixtureProofSchema,
  WriteFixtureSaveCommit,
  writeFixtureDescriptor,
  writeFixtureSaveDescriptor,
  writeFixtureSessionManager,
  writeFixtureSessions,
} from "../../support/fixtures/write-sequencer-fixtures.js";


function commitContracts(): readonly AnyCommitTaskContract[] {
  const contracts: AnyCommitTaskContract[] = [];
  const world = createWriteFixtureWorld();
  const stores = [...taskStoreRegistry.stores, ...buildWriteFixtureRegistry(world).stores];
  for (const store of stores) {
    for (const task of Object.values(store.tasks)) {
      if (task.contract.effect === "commit") contracts.push(task.contract);
    }
  }
  for (const descriptor of [...DESCRIPTORS, fixtureDescriptor, writeFixtureDescriptor, writeFixtureSaveDescriptor]) {
    for (const node of descriptorRuntimeNodes(descriptor)) {
      if (node.kind === "transaction") contracts.push(node.commit.uses);
    }
  }
  assert.ok(contracts.length >= 2, "the sweep must see real commit contracts");
  return contracts;
}

describe("write-safety contract completeness (no escape hatch)", () => {
  it("every commit contract carries the full completion + idempotency shape", () => {
    for (const contract of commitContracts()) {
      const { completion, idempotency } = contract.writeSafety;
      assert.ok(completion.proofSchema instanceof z.ZodType, contract.id);
      assert.equal(typeof completion.proofFromOutput, "function", contract.id);
      assert.equal(typeof completion.proofFromPresentProbe, "function", contract.id);
      assert.equal(typeof completion.outputFromProof, "function", contract.id);
      assert.equal(typeof idempotency.key, "function", contract.id);
      // Same-store zero-age read probe.
      const system = (id: string) => id.slice(0, id.indexOf("/"));
      assert.equal(idempotency.probe.effect, "read", contract.id);
      assert.equal(system(idempotency.probe.taskId), system(contract.id), contract.id);
      if (completion.kind !== "receipt") {
        assert.equal(completion.verify.effect, "read", contract.id);
        assert.equal(system(completion.verify.taskId), system(contract.id), contract.id);
      }
      // Normal-output, present-probe, and reconstruction paths parse the SAME
      // proof and commit-output schemas (the sealed example round-trip).
      const output = contract.output.parse(contract.example);
      const proof = completion.proofSchema.parse(Reflect.apply(completion.proofFromOutput, undefined, [output]));
      const probeProof = completion.proofSchema.parse(Reflect.apply(
        completion.proofFromPresentProbe,
        undefined,
        [probeVerdictSchema(completion.proofSchema).parse({ state: "present", proof })],
      ));
      assert.equal(canonicalJsonStringify(proof), canonicalJsonStringify(probeProof), contract.id);
      const reconstructed = contract.output.parse(Reflect.apply(completion.outputFromProof, undefined, [proof]));
      assert.equal(canonicalJsonStringify(output), canonicalJsonStringify(reconstructed), contract.id);
      // The proof schema is nontrivial: a garbage value must NOT parse.
      assert.equal(completion.proofSchema.safeParse({ forged: true }).success, false, contract.id);
    }
  });

  it("rejects an effect:commit declaration without writeSafety — there is no escape hatch", () => {
    const stripped: Record<string, unknown> = { ...WriteFixtureCommit };
    delete stripped.writeSafety;
    delete stripped.__sealed;
    assert.equal(RuntimeTaskContractDefinitionSchema.safeParse(stripped).success, false);
  });

  it("accepts save-verify WITHOUT a confirmation number — demanding receipt of it is a guard bug", () => {
    assert.equal(WriteFixtureSaveCommit.writeSafety.completion.kind, "save-verify");
    // The union walk above already accepted it; pin that a receipt-only checker
    // is wrong: it would reject a contract this guard must accept.
    const receiptOnly = (contract: AnyCommitTaskContract) => contract.writeSafety.completion.kind === "receipt";
    assert.equal(receiptOnly(WriteFixtureSaveCommit), false);
    assert.equal(receiptOnly(WriteFixtureCommit), true);
    const kinds = new Set(commitContracts().map(({ writeSafety }) => writeSafety.completion.kind));
    assert.ok(kinds.has("receipt") && kinds.has("save-verify"), "the union sweep must see both arms");
  });

  it("a success whose proof fails its schema can never become done", () => {
    assert.equal(WriteFixtureProofSchema.safeParse({ transactionId: "" }).success, false);
    assert.equal(WriteFixtureProofSchema.safeParse({ transactionId: "T1" }).success, false);
    assert.equal(WriteFixtureProofSchema.safeParse({ transactionId: "T123456" }).success, true);
  });
});

describe("crash recovery routes probe-first with evidence-qualified settlement", () => {
  function recoveryWorld() {
    const clock = manualClock(new Date("2026-08-03T09:00:00.000Z"));
    const profile = createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "write-safety-guard" },
      clock,
    );
    const world = createWriteFixtureWorld();
    const registry = buildWriteFixtureRegistry(world);
    testWorkerPorts(database, clock, { path: profile.path, descriptor: writeFixtureDescriptor, poolIndex: 1 });
    const recovery = createWriteRecoveryService({
      continuation: testRunContinuation(database, clock),
      stores: registry,
      authority: database,
      sessions: writeFixtureSessionManager(writeFixtureSessions(world), registry, clock),
      clock,
      ids: sequentialIdFactory("c"),
      scheduler: new ManualScheduler(clock),
      taskDeadlineMs: 60_000,
      operator: "local-operator",
      log: recordingLogger().log,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    });
    return {
      clock, database, world, recovery,
      dispose: () => {
        const now = clock.now().toISOString();
        const authorityReason = deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "fixture release");
        for (const run of database.authority.runs.listByWorkflow(writeFixtureDescriptor.id)) {
          for (const intent of database.authority.writeIntents.listByRun(run.envelope.runId)) {
            if (intent.status !== "attempting") continue;
            database.authority.writeIntents.parkAttempt({
              writeIntentId: intent.writeIntentId, generation: intent.generation, expectedVersion: intent.version,
              code: "unknown", message: "fixture release", authorityReason, now,
            });
          }
        }
        releaseSeededWriteOwners(database, now);
        database.close();
        profile.close();
      },
    };
  }

  it("walks present→validated-backfill, early-absent→wait, stabilized→retryable, throw→park", async () => {

    const { parkedAttemptingWriteFixture } = await import("./helpers/write-guard-fixtures.js");

    // present → the SAME proof parser beat ⑥ uses, then atomic backfill.
    {
      const w = recoveryWorld();
      const { writeIntentId } = parkedAttemptingWriteFixture(w.database, w.clock);
      w.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
      const decision = await w.recovery.recover({
        descriptor: writeFixtureDescriptor, writeIntentId, signal: new AbortController().signal,
      });
      assert.equal(decision.state, "backfilled");
      assert.equal(w.database.authority.writeIntents.get(writeIntentId)?.status, "committed");
      assert.deepEqual(w.world.events, ["probe"], "the probe ran FIRST and nothing else touched a browser");
      w.dispose();
    }
    // one early absence → wait; zero retry authority, zero durable change.
    {
      const w = recoveryWorld();
      const { writeIntentId } = parkedAttemptingWriteFixture(w.database, w.clock);
      w.world.probeResults.push(absentProbeEvidence(w.clock.now().toISOString()));
      const decision = await w.recovery.recover({
        descriptor: writeFixtureDescriptor, writeIntentId, signal: new AbortController().signal,
      });
      assert.equal(decision.state, "wait");
      assert.equal(w.database.authority.writeIntents.get(writeIntentId)?.status, "attempting");
      w.dispose();
    }
    // stabilized same-key negative evidence → retryable (the ONLY retry path).
    {
      const w = recoveryWorld();
      const { writeIntentId } = parkedAttemptingWriteFixture(w.database, w.clock);
      w.clock.advanceWall(31_000);
      const first = absentProbeEvidence(w.clock.now().toISOString(), "observation:55555555-5555-4555-8555-555555555555");
      w.clock.advanceWall(6_000);
      w.world.probeResults.push(absentProbeEvidence(w.clock.now().toISOString()));
      const decision = await w.recovery.recover({
        descriptor: writeFixtureDescriptor,
        writeIntentId,
        priorVerdicts: [first],
        signal: new AbortController().signal,
      });
      assert.equal(decision.state, "safe-to-retry");
      assert.equal(w.database.authority.writeIntents.get(writeIntentId)?.status, "retryable");
      w.dispose();
    }
    // a throwing probe is unknown → park; never absent, never retry.
    {
      const w = recoveryWorld();
      const { writeIntentId } = parkedAttemptingWriteFixture(w.database, w.clock);
      w.world.probeResults.push(new Error("target system unreachable"));
      const decision = await w.recovery.recover({
        descriptor: writeFixtureDescriptor, writeIntentId, signal: new AbortController().signal,
      });
      assert.equal(decision.state, "parked");
      assert.equal(w.database.authority.writeIntents.get(writeIntentId)?.status, "parked");
      w.dispose();
    }
  });

  it("blocks a second fence for a permanent key in every non-retryable state", async () => {
    const { parkedAttemptingWriteFixture, foreignAttemptingIntent } = await import("./helpers/write-guard-fixtures.js");
    const w = recoveryWorld();
    parkedAttemptingWriteFixture(w.database, w.clock);
    const second = foreignAttemptingIntent("55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666");
    const resolution = fenceWriteFixture(w.database, second);
    assert.equal(resolution.state, "existing", "the permanent primary key is the same-key mutex");
    if (resolution.state === "existing") {
      assert.equal(resolution.intent.idempotencyKey, WRITE_FIXTURE_KEY);
    }
    w.dispose();
  });
});
