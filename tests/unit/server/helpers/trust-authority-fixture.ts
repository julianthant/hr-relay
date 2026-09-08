import assert from "node:assert/strict";
import { join } from "node:path";
import { RunRecordService } from "../../../../src/core/run-record-service.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../src/domain/config/runtime-generation.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/domain/run/record.js";
import { ArchivedRunContentSchema, ArchivedRunRecordSchema, archivedRunContentDigest } from "../../../../src/domain/archive/model.js";
import { AuthorityDatabase } from "../../../../src/infra/sqlite/authority-database.js";
import { createReceiptService } from "../../../../src/server/trust/receipt-service.js";
import { createTrustRunReader } from "../../../../src/server/trust/canonical-reader.js";
import { type RunDetailQueryDeps } from "../../../../src/server/dashboard/queries/run-detail-types.js";
import { CONFIG_SNAPSHOT, HASH_A } from "../../../fixtures/phase1c-contract-fixtures.js";
import { ARCHIVED_RUN } from "../../../fixtures/archive-fixtures.js";
import { personLookupDescriptor } from "../../../helpers/registered-workflows.js";
import { personLookupQueuedRun } from "../../../helpers/phase1f-executor-harness.js";
import { makeWorld, uuidOf } from "./dashboard-harness.js";

/** Trust acceptance uses actual SQLite service reads; the empty projector supplies evidence only. */
export function trustWorld() {
  const world = makeWorld();
  const database = AuthorityDatabase.open({ path: join(world.stateRoot, "trust.sqlite"),
    busyTimeoutMs: 250, migrationOwner: "trust-linkage-test" }, world.clock);
  database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
  const active = database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: HASH_A,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    activatedAt: world.clock.now().toISOString() });
  const runtimeConfig = RuntimeConfigClaimTokenSchema.parse({ generation: active.generation, settingsRevision: active.settingsRevision,
    settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint });
  let next = 900;
  const service = new RunRecordService({ database, clock: world.clock,
    ids: { uuid: () => uuidOf(next++) }, publishQueued: () => {} });
  const reader = createTrustRunReader(database, world.clock);
  const receipts = createReceiptService({ database, runReader: reader, descriptors: [personLookupDescriptor] });
  const deps: RunDetailQueryDeps = { stateRoot: world.stateRoot, projection: world.projection, runReader: reader,
    authority: { getRun: () => { throw new Error("RAW_RUN_READ_FORBIDDEN"); },
      latestCheckpoint: (workflow, item, node) => database.authority.runCheckpoints.latest(workflow, item, node),
      getWriteIntent: id => database.authority.writeIntents.get(id),
      listGateResults: id => database.authority.gateResults.listByRun(id) },
    descriptors: { resolve: () => undefined }, trust: receipts };
  const create = (seed: number) => {
    const template = RunRecordSchema.parse(personLookupQueuedRun({ runId: uuidOf(seed) }));
    const outcome = service.create({ commandId: uuidOf(seed), code: personLookupDescriptor.code,
      matchKey: `trust-item-${String(seed)}`, workflow: personLookupDescriptor.id,
      descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
      configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
      resolvedInstance: template.envelope.resolvedInstance, priority: "bulk", shape: "single", dryRun: true,
      input: template.input, runtimeConfig });
    assert.equal(outcome.state, "applied");
    if (outcome.state !== "applied") throw new Error("fixture create failed");
    return outcome.run;
  };
  const cancel = (run: RunRecord, seed: number) => {
    const outcome = service.transition({ commandId: uuidOf(seed), runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: world.clock.now().toISOString() } });
    assert.equal(outcome.state, "applied");
    if (outcome.state !== "applied") throw new Error("fixture cancel failed");
    return outcome.run;
  };
  return { world, database, service, reader, receipts, deps, runtimeConfig, create, cancel,
    dispose() { database.close(); world.dispose(); } };
}

export function trustArchiveRecord(run: RunRecord) {
  if (run.lifecycle.state !== "terminal") throw new Error("archive fixture requires a terminal run");
  const { contentDigest: _digest, ...template } = ARCHIVED_RUN;
  const status = run.lifecycle.outcome === "interrupted" ? "blocked"
    : run.lifecycle.outcome === "failed" ? "failed"
      : run.lifecycle.outcome === "done" ? "done" : "cancelled";
  const detailOutcome = run.lifecycle.outcome === "interrupted"
    ? { state: "absent" as const, reason: "run interrupted; ref write-safety recovery will requeue or settle it" }
    : {
        state: "terminal" as const,
        result: run.lifecycle.outcome === "done" ? run.envelope.dryRun ? "partial" as const : "verified-done" as const
          : run.lifecycle.outcome === "failed" ? "failed" as const : "cancelled" as const,
        completedAt: run.lifecycle.endedAt,
        ...(run.lifecycle.outcome === "done" && run.envelope.dryRun ? { rehearsal: true as const } : {}),
      };
  const content = ArchivedRunContentSchema.parse({
    ...template,
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    traceId: run.envelope.traceId,
    archivedIdentity: {
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    },
    input: run.input,
    row: {
      ...template.row,
      runId: run.envelope.runId,
      itemId: run.envelope.itemId,
      workflowId: run.envelope.workflow,
      traceId: run.envelope.traceId,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      descriptorHash: run.envelope.contractFingerprint,
      configFingerprint: run.envelope.configFingerprint,
      dryRun: run.envelope.dryRun,
      priority: run.envelope.priority,
      runNumber: run.runNumber === undefined
        ? { state: "absent", reason: "historical run had no ordinal" }
        : { state: "present", value: run.runNumber },
      rowRevision: run.version,
      status,
      endedAt: { state: "present", value: run.lifecycle.endedAt },
    },
    detail: {
      ...template.detail,
      runId: run.envelope.runId,
      rowRevision: run.version,
      header: {
        ...template.detail.header,
        runId: run.envelope.runId,
        traceId: run.envelope.traceId,
        workflowId: run.envelope.workflow,
        status,
        attempt: run.envelope.attempt,
      },
      outcome: detailOutcome,
    },
  });
  return ArchivedRunRecordSchema.parse({
    ...content,
    contentDigest: archivedRunContentDigest(content),
  });
}

