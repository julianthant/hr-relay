import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService, requireLifecycleApplied, type CreateRunRequest } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../src/models/config/runtime-generation.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";

import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1, UUID_5, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase, type AuthorityLifecycleHooks, type AuthorityTerminalizationHooks } from "../../../support/helpers/synthetic-storage-admission.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture(
  terminalizationHooks?: AuthorityTerminalizationHooks,
  lifecycleHooks?: AuthorityLifecycleHooks,
) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "run-record-service-"));
  cleanups.push(() => rmSync(root, { recursive: true }));
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), migrationOwner: "unit-test", busyTimeoutMs: 250 },
    clock,
    undefined,
    terminalizationHooks,
    lifecycleHooks,
  );
  cleanups.push(() => database.close());
  const active = database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  testWorkerPorts(database,clock,{path:join(root,"state.db"),descriptor:personLookupDescriptor,poolIndex:1});
  const runtimeConfig = RuntimeConfigClaimTokenSchema.parse({
    generation: active.generation, settingsRevision: active.settingsRevision,
    settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint,
  });
  let next = 100;
  const published: RunRecord[] = [];
  const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const service = new RunRecordService({ database, clock,
    ids: { uuid: () => `10000000-0000-4000-8000-${String(next++).padStart(12, "0")}` },
    publishQueued: (run) => {
      assert.equal(database.authority.runs.get(run.envelope.runId)?.version, 1);
      emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic run" }));
      database.afterAuthorityCommit(() => published.push(run));
    },
  });
  const request: CreateRunRequest = {
    commandId: UUID_1, code: "pl", matchKey: "synthetic-item", workflow: WORKFLOW_ID,
    descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
    contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
    resolvedInstance: RunRecordSchema.parse(QUEUED_RUN).envelope.resolvedInstance,
    priority: "bulk", shape: "single", dryRun: true,
    input: QUEUED_RUN.input, runtimeConfig,
  };
  return { database, service, clock, request, runtimeConfig, published, root };
}

function created(service: RunRecordService, request: CreateRunRequest) {
  const outcome = service.create(request);
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("create did not apply");
  return outcome.run;
}

describe("protected canonical command fingerprints", () => {

  it("binds protected input identity and safe facts in current create journals", () => {
    const journals = (emplId: string, memo = "ordinary fact", sourceId = "10000000-0000-4000-8000-000000000001") => {
      const f = fixture();
      const request = { ...f.request, input: { ...f.request.input, raw: { emplId, memo },
        parsed: { ...f.request.input.parsed, value: { emplId, memo }, protectedBindings: [{
          kind: "test-data-local" as const, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const, sourceId }] } } };
      const run = created(f.service, request);
      assert.deepEqual(run.input.raw, { emplId, memo });
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(f.service.create(request).state, "applied-already");
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      const terminal = requireLifecycleApplied(f.service.transition({ commandId: UUID_5,
        runId: run.envelope.runId, expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
      const deletion={runId:terminal.envelope.runId,expectedVersion:terminal.version,commandId:UUID_6};
      assert.equal(f.service.delete(deletion).state,"deleted");
      assert.equal(f.service.delete(deletion).state,"applied-already");
      return [request.commandId].map((commandId) => {
        const journal = f.database.authority.lifecycleJournal.getCommand(commandId);
        assert.ok(journal && "requestFingerprint" in journal);
        return journal.requestFingerprint;
      });
    };
    assert.deepEqual(journals("10812345"), journals("10854321"));
    const original = journals("10812345");
    const changedFact = journals("10812345", "changed ordinary fact");
    const changedIdentity = journals("10812345", "ordinary fact", "10000000-0000-4000-8000-000000000002");
    original.forEach((fingerprint, index) => {
      assert.notEqual(fingerprint, changedFact[index]);
      assert.notEqual(fingerprint, changedIdentity[index]);
    });
  });
});
