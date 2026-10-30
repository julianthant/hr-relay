import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import { createBoundProfileFixture } from '../helpers/admission-fixture.js';
import assert from "node:assert/strict";
import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { ExplorerEditApplyRequestSchema, ExplorerEditApplyResultSchema } from "../../../src/models/dashboard/explorer.js";
import { explorerEditCommandFingerprint } from "../../../src/models/dashboard/explorer-override.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../helpers/synthetic-storage-admission.js";
import { createExplorerEditService } from "../../../src/backend/runs/commands/explorer-edit-service.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { explorerQueryDeps } from "./explorer-seams.js";
import { sequentialIdFactory } from "./phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "./intake-kernel-seams.js";

const retainedExplorerAuthorityOwners = new Set<object>();

export async function explorerAuthorityFixture(owned?: Readonly<{
  root: string; path: string; open: () => AuthorityDatabase; dispose: () => void | Promise<void>;
}>) {
  const held: { profile?: Awaited<ReturnType<typeof createBoundProfileFixture>>; database?: AuthorityDatabase; owned?: typeof owned; primary?: { error: unknown }; failure?: Error } = { owned };
  retainedExplorerAuthorityOwners.add(held);
  try {
  const profile = owned === undefined ? await createBoundProfileFixture() : undefined; held.profile = profile;
  const selected = owned ?? profile;
  if (selected === undefined) throw new Error('explorer-fixture-owner-required');
  const root = 'root' in selected ? selected.root : selected.stateRoot;
  const path = selected.path;
  const clock = manualClock(new Date("2026-09-13T10:00:00Z"));
  const query = explorerQueryDeps(clock, FingerprintSchema.parse("b".repeat(64)));
  const descriptor = query.modules.find(module => module.descriptor.id === "person-lookup")?.descriptor;
  assert.ok(descriptor);
  const open = () => owned === undefined ? AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "explorer-proof" }, clock) : owned.open();
  let database = open(); held.database = database;
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
      configIdentity: UNSTORED_CONFIG_IDENTITY,
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { recheck: () => { throw new Error("Explorer must not resolve a write"); }, resolveAbsent: () => { throw new Error("Explorer must not resolve a write"); } },
      workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker"); }, spawnPoolWorker: () => { throw new Error("unexpected worker"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker"); }, stopPoolWorker: () => { throw new Error("unexpected worker"); }, pausePoolWorker: () => { throw new Error("unexpected worker"); }, resumePoolWorker: () => { throw new Error("unexpected worker"); } } },
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
  let closeAttempted = false;
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
    restart() {
      if (held.failure !== undefined) throw held.failure;
      try { database.close(); database = open(); held.database = database; composed = compose(); }
      catch (error) { held.primary = { error }; held.failure = retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }
    },
    async dispose() {
      if (held.failure !== undefined) throw held.failure;
      if (closeAttempted) return;
      closeAttempted = true;
      try { database.close(); if (owned === undefined) await profile?.close(); else await owned.dispose(); retainedExplorerAuthorityOwners.delete(held); }
      catch (error) { held.primary = { error }; held.failure = retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }
    },
  };
  } catch (error) { held.primary = { error }; held.failure = retainAuthoritySourceClosure([error], { admission: held }); throw held.failure; }
}
