import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { FingerprintSchema, RunIdSchema } from "../../../src/domain/ids.js";
import { ArchiveFileReferenceSchema } from "../../../src/domain/archive/report.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { foundationFixture, NOW, HASH, id } from "../database-foundation/fixtures.js";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { RunRecordService } from "../../../src/backend/runs/run-record-service.js";
import { createCommandKernel, type CommandKernelDependencies } from "../../../src/backend/runs/command-kernel.js";
import { createRuntimeVersionChanges } from "../../../src/backend/runs/archive/archive-runtime-version-changes.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { ARCHIVED_RUN_WITH_SECTIONS } from "../../fixtures/archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";

export function archiveFixture(options: Parameters<typeof foundationFixture>[0] = {}) {
  const base = foundationFixture(options);
  let database = base.db;
  let sequence = 9500;
  let fail: string | undefined;
  let failCount = 1;
  const descriptor = { ...personLookupDescriptor, version: 2, contractFingerprint: FingerprintSchema.parse(HASH) };
  const create = () => {
    const settle = database.settleArchivedDeletion.bind(database);
    database.settleArchivedDeletion = runId => {
      if (fail === "settlement") { fail = undefined; throw new Error("injected-settlement"); }
      settle(runId);
    };
    const lifecycle = new RunRecordService({ database, clock: base.clock, ids: { uuid: () => id(++sequence) }, publishQueued: () => {} });
    const storage = lifecycle.lifecycleStorage();
    lifecycle.lifecycleStorage = () => new Proxy({ ...storage }, { get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        if (fail === property && --failCount === 0) { fail = undefined; throw new Error(`injected-${String(property)}`); }
        return result;
      };
    } });
    const archiveSnapshots: CommandKernelDependencies["archiveSnapshots"] = { snapshot: runId => {
      const source = ARCHIVED_RUN_WITH_SECTIONS;
      assert.ok(source.sections);
      return { row: QueueSurfaceWireSchema.parse({ ...source.row, session: {state:"absent",reason:"Historical archive fixture predates run batches"}, runId: RunIdSchema.parse(runId) }), detail: { ...source.detail, header: { ...source.detail.header, runId: RunIdSchema.parse(runId) } }, failure: source.failure, sections: source.sections };
    }, snapshotBatch(runIds) { return new Map(runIds.map(runId => [runId, this.snapshot(runId)])); } };
    const deps: CommandKernelDependencies = {
      lifecycle, authority: { withAuthorityTransaction: work => database.withAuthorityTransaction(repos => work({ ...repos,
        commandAudits: { ...repos.commandAudits, insert(value) {
          if (fail === "audit") { fail = undefined; throw new Error("injected-audit"); }
          return repos.commandAudits.insert(value);
        } },
      })) }, clock: base.clock, ids: { uuid: () => id(++sequence) }, appVersion: "0.1.0",
      descriptors: { resolve: workflow => workflow === "person-lookup" ? descriptor : undefined },
      configIdentity: { configFingerprint: base.snapshot.fingerprint, configSnapshotId: base.snapshot.configSnapshotId },
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { resolveAbsent: () => { throw new Error("unused"); }, resolvePresent: () => { throw new Error("unused"); } },
      workerRuntime: { planWorkerCount: () => { throw new Error("unused"); }, spawnWorker: () => { throw new Error("unused"); }, refreshBrowser: () => { throw new Error("unused"); }, reopenBrowser: () => { throw new Error("unused"); } },
      archiveSnapshots,
      runtimeVersionChanges: createRuntimeVersionChanges({ database, clock: base.clock, ids: { uuid: () => id(++sequence) }, archiveSnapshots,
        afterTransferStep: (_runId, step) => {
          if (fail === step && --failCount === 0) { fail = undefined; throw new Error(`injected-${step}`); }
        } }),
    };
    return createCommandKernel(deps);
  };
  let kernel = create();
  const envelope = () => ({ commandId: id(++sequence), requestedAt: NOW, requestedBy: "local-operator", source: "archive", family: "version-archive" });
  return { base, get database() { return database; }, get kernel() { return kernel; },
    failAfter(step: string, occurrence = 1) { fail = step; failCount = occurrence; },
    reopen() { database.close(); database = AuthorityDatabase.open({ path: base.path, busyTimeoutMs: 250, migrationOwner: "archive-recovery" }, base.clock); kernel = create(); },
    terminal() { const result = database.authority.runs.transition({ runId: base.run.envelope.runId, expectedVersion: base.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW }); assert.equal(result.state, "applied"); },
    plan(kind: "major" | "minor" = "major") {
      const result = kernel.execute({ ...envelope(), type: "plan-version-bump", target: { scope: { kind: "workflows", workflowIds: ["person-lookup"] } },
        payload: { targetVersion: "2.0.0", changeFingerprint: HASH, changeRecord: { kind, what: "Synthetic archive", why: "Recovery proof", commit: { state: "absent", reason: "test" } } } });
      assert.equal(result.state, "applied");
      if (result.state !== "applied") throw new Error("plan refused");
      const target = result.affectedTargets.find(value => value.family === "version-archive");
      if (target?.family !== "version-archive") throw new Error("plan target missing");
      const row = database.readVersionChange(target.versionPlanId); assert.ok(row); return row;
    },
    applyRequest(row: ReturnType<AuthorityDatabase["readVersionChange"]>) {
      assert.ok(row);
      return CommandRequestSchema.parse({ ...envelope(), type: "apply-version-bump", target: { versionPlanId: row.changeId, expectedVersion: 1 }, payload: { planFingerprint: row.reviewFingerprint } });
    },
    dispose() { database.close(); base.dispose(); },
  };
}

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function attachFile(database: AuthorityDatabase, root: string, runId: string, n: number, bytes = Buffer.from("synthetic shared evidence")) {
  const file = ArchiveFileReferenceSchema.parse({ digest: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, mediaType: "text/yaml", name: "accessibility-excerpt", artifactIds: [id(n)] });
  mkdirSync(join(root, "artifacts"), { recursive: true });
  writeFileSync(join(root, "artifacts", `${file.digest}.artifact`), JSON.stringify({ ref: { id: id(n), sha256: file.digest, bytes: bytes.length, mediaType: file.mediaType }, payloadBase64: bytes.toString("base64") }));
  database.authority.diagnosticBundles.insert({ bundleId: id(n + 1), runId, origin: { kind: "operator-request", requestedBy: "local-operator" }, createdAt: NOW,
    contentDigest: HASH, configFingerprint: HASH, descriptorFingerprint: HASH, redaction: { fields: [], warnings: [] },
    attachments: [{ kind: "accessibility-excerpt", artifactId: id(n), digest: file.digest, byteLength: bytes.length, mediaType: file.mediaType, sensitivity: "redacted" }],
    retention: { kind: "ordinary", purgeAfter: "2030-01-01T00:00:00.000Z" } });
  return { file, bytes };
}
