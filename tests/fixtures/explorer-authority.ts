import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandKernel } from "../../src/core/command-kernel.js";
import { RunRecordService } from "../../src/core/run-record-service.js";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { ExplorerEditApplyRequestSchema, ExplorerEditApplyResultSchema } from "../../src/domain/dashboard/explorer.js";
import { explorerEditCommandFingerprint } from "../../src/domain/dashboard/explorer-override.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../helpers/synthetic-storage-admission.js";
import { createExplorerEditService } from "../../src/server/dashboard/commands/explorer-edit-service.js";
import { buildWorkflowExplorer } from "../../src/server/dashboard/queries/explorer.js";
import { explorerQueryDeps } from "./explorer-seams.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "./archive-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "./intake-kernel-seams.js";

export function explorerAuthorityFixture() {
  const root = mkdtempSync(join(tmpdir(), "explorer-authority-"));
  const path = join(root, "state.db");
  const clock = manualClock(new Date("2026-09-13T10:00:00Z"));
  const query = explorerQueryDeps(clock, FingerprintSchema.parse("b".repeat(64)));
  const descriptor = query.modules.find(module => module.descriptor.id === "person-lookup")?.descriptor;
  assert.ok(descriptor);
  let database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "explorer-proof" }, clock);
  let transactionCount = 0;
  let failAudit = false;
  let omitOverrideWrite = false;
  const ids = sequentialIdFactory("d");
  const compose = () => {
    const service = createExplorerEditService({ explorer: query, overrides: database.authority.explorerOverrides });
    const kernel = createCommandKernel({
      lifecycle: new RunRecordService({ database, clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
      authority: { withAuthorityTransaction: work => {
        transactionCount += 1;
        return database.withAuthorityTransaction(repositories => work({ ...repositories,
          commandAudits: { ...repositories.commandAudits, insert: input => {
            if (failAudit) throw new Error("injected Explorer audit failure");
            return repositories.commandAudits.insert(input);
          } },
        }));
      } },
      appVersion: "0.1.0", clock, ids,
      descriptors: { resolve: id => query.modules.find(module => module.descriptor.id === id)?.descriptor },
      archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS, configIdentity: UNSTORED_CONFIG_IDENTITY,
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { resolvePresent: () => { throw new Error("Explorer must not resolve a write"); }, resolveAbsent: () => { throw new Error("Explorer must not resolve a write"); } },
      workerRuntime: { planWorkerCount: () => { throw new Error("unexpected worker"); }, spawnWorker: () => { throw new Error("unexpected worker"); }, refreshBrowser: () => { throw new Error("unexpected worker"); }, reopenBrowser: () => { throw new Error("unexpected worker"); } },
      explorerEdits: { apply: (input, repositories: AuthorityRepositories) => {
        assert.equal(repositories.explorerOverrides, database.authority.explorerOverrides);
        if (omitOverrideWrite) {
          const validation = service.validate({ draftVersion: 1, workflowId: input.target.workflowId,
            baseDescriptorVersion: input.target.expectedVersion, baseContractFingerprint: input.target.contractFingerprint,
            baseOverrideRevision: input.target.expectedOverrideRevision, changes: input.payload.changes });
          assert.equal(validation.state, "ready-to-apply");
          if (validation.state !== "ready-to-apply") throw new Error("fixture requires a valid presentation draft");
          const override = { ...validation.override, appliedCommandId: input.commandId, commandFingerprint: explorerEditCommandFingerprint(input) };
          return { result: ExplorerEditApplyResultSchema.parse({ state: "applied", override, readback: override }) };
        }
        return service.apply(input, repositories);
      } },
    });
    return { service, kernel };
  };
  let composed = compose();
  return {
    root, path, clock, descriptor,
    get database() { return database; },
    get kernel() { return composed.kernel; },
    get service() { return composed.service; },
    get transactionCount() { return transactionCount; },
    failAudit(value: boolean) { failAudit = value; },
    omitOverrideWrite(value: boolean) { omitOverrideWrite = value; },
    command(id: string, revision = 0, label = "People search") {
      return ExplorerEditApplyRequestSchema.parse({ commandId: id, requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator", source: "dashboard", reason: "Reviewed presentation",
        family: "explorer", type: "apply-explorer-edit",
        target: { workflowId: descriptor.id, expectedVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, expectedOverrideRevision: revision },
        payload: { changes: [{ kind: "workflow-label", value: label }] } });
    },
    read() { return buildWorkflowExplorer({ ...query, overrides: database.authority.explorerOverrides }); },
    restart() { database.close(); database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "explorer-restart-proof" }, clock); composed = compose(); },
    dispose() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
