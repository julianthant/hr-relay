import { createWriteRecoveryTestWorld } from "../../../support/helpers/backend/write-recovery-world.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService, runContinuationPort } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { testRunContinuation } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { WriteResolutionContext } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createWriteResolutionExecutor } from "../../../../src/backend/runtime/writes/write-recovery.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { CONFIG_SNAPSHOT, UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WRITE_FIXTURE_IMPL_FINGERPRINT, WRITE_FIXTURE_KEY_DIGEST, WRITE_FIXTURE_NOW, writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const { disposers, SIGNAL, harness, ownBindingProof, parkedAttemptingWrite } = createWriteRecoveryTestWorld();

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("ref write-safety §4.1 typed operator resolutions (the kernel seam)", () => {
  function resolutionHarness(descriptor = writeFixtureDescriptor) {
    const h = harness();
    const executor = createWriteResolutionExecutor({
      continuation: testRunContinuation(h.database, h.clock),
      descriptors: {
        resolve: (workflowId) =>
          String(descriptor.id) === workflowId ? descriptor : undefined,
      },
      authority: h.database,
      ids: h.ids,
      resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
    });
    const makeKernel=()=>{
    const lifecycle = new RunRecordService({database:h.database,clock:h.clock,ids:h.ids,publishQueued:()=>{}});
    const unused=():never=>{throw new Error("unused operator resolution port");};
    const kernel=createCommandKernel({authority:h.database,lifecycle,clock:h.clock,ids:h.ids,appVersion:"1.0.0",
      descriptors:{resolve:workflow=>workflow===String(descriptor.id)?descriptor:undefined},
      configIdentity:{configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,configFingerprint:CONFIG_SNAPSHOT.fingerprint},
      intakeParser:UNWIRED_INTAKE_PARSER,intakeProjections:NO_INTAKE_PROJECTIONS,
      workerRuntime:{pool:{planPoolWorkerCount:unused,spawnPoolWorker:unused,refreshPoolBrowser:unused,reopenPoolBrowser:unused,
        stopPoolWorker:unused,pausePoolWorker:unused,resumePoolWorker:unused}},
      writeResolution:createWriteResolutionExecutor({authority:h.database,continuation:runContinuationPort(lifecycle),
        descriptors:{resolve:workflow=>workflow===String(descriptor.id)?descriptor:undefined},ids:h.ids,
        resolveImplFingerprint:()=>WRITE_FIXTURE_IMPL_FINGERPRINT})});
    return kernel;
    };
    return { h, executor, kernel:makeKernel(),makeKernel };
  }

  function commandFor(type: "resolve-write-present" | "resolve-write-absent", run: RunRecord, payload: Record<string, unknown>) {
    return CommandRequestSchema.parse({
      commandId: UUID_7,
      requestedAt: WRITE_FIXTURE_NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type,
      target: {
        runId: run.envelope.runId,
        expectedVersion: run.version,
        writeIntentId: UUID_8,
        intentGeneration: 1, writeAttemptId: UUID_5, bindingProofDigest: deriveWriteBindingProofDigest(ownBindingProof()),
      },
      payload: {...payload,occurrenceKeyDigest:WRITE_FIXTURE_KEY_DIGEST},
    });
  }

  it("refuses to resolve a committed intent — there is no reopen of committed history", () => {
    const { h, executor } = resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
    return h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL })
      .then((decision) => {
        assert.equal(decision.state, "backfilled");
        const committed = h.database.authority.writeIntents.get(writeIntentId);
        assert.ok(committed);
        const command = commandFor("resolve-write-absent", run, { evidenceNote: "stale operator tab" });
        if (command.family !== "run" || command.type !== "resolve-write-absent") throw new Error("unreachable");
        const context: WriteResolutionContext = Object.freeze({
          auditId:UUID_6, command, run, intent: committed, now: h.clock.now().toISOString(),
        });
        assert.throws(
          () => h.database.withAuthorityTransaction((repositories) => executor.resolveAbsent(repositories, context)),
          /has no operator resolution/,
        );
        assert.equal(h.database.authority.writeIntents.get(writeIntentId)?.status, "committed");
      });
  });
});
