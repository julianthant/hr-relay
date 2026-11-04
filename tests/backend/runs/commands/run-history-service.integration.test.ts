import { z } from "zod";
import { ArtifactRefSchema, type ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import { findProfileFixtureAdmission } from "../../../support/helpers/admission-fixture.js";
import { enumerateProfileCredentialMembership } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { ExtractPdfPagesOutputSchema } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { deletedRunFromRow } from "../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createRunHistoryService } from "../../../../src/backend/runs/commands/run-history-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createContentAddressedArtifactWriter, removeArtifactDeletionFile } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { ClearRunHistoryRequestSchema } from "../../../../src/models/dashboard/run-history.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-database-admission.js";
import { CONFIG_SNAPSHOT, HASH_A, NOW, UUID_3, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { HISTORY_NOW, historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const request = () => ClearRunHistoryRequestSchema.parse({ commandId: randomUUID() });

async function fixture() {
  const profile = await profiles.create();
  let failStep: string | undefined;
  let faultAt = 1, matchedSteps = 0;
  let fileFault = false;
  const open = () => AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "history-test" }, undefined, undefined, undefined, {
    afterDeleteStep: ({ step }) => { if (step === failStep && ++matchedSteps === faultAt) throw new Error("history-delete-fault"); },
    afterDeletionFileRemoved: () => { if (fileFault) throw new Error("history-file-fault"); },
  });
  let database = open();
  cleanups.push(async () => { database.close(); await profile.close(); });
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  let refreshed = 0;
  const lifecycle = () => new RunRecordService({ database, clock: capturedInstantClock(NOW), ids: sequentialIdFactory(), publishQueued() {} });
  const service = () => createRunHistoryService({ database, lifecycle: lifecycle(), afterClear() { refreshed++; } });
  const seed = (id = randomUUID(), parent?: ReturnType<typeof RunRecordSchema.parse>, terminal = true) => {
    const run = RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId: id, itemId: id,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      ...(parent === undefined ? {} : { parent: { runId: parent.envelope.runId, tracePrefix: parent.envelope.traceId, edgeId: "child-probe" } }) } });
    database.authority.runs.enqueue(run);
    if (!terminal) return run;
    const result = lifecycle().transition({ commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "discarded", endedAt: NOW } });
    if (result.state !== "applied") throw new Error("fixture-terminal-refused");
    return result.run;
  };
  const diagnostic = async (run: ReturnType<typeof seed>) => {
    const writer = createContentAddressedArtifactWriter({ admission: profile.admission });
    await writer.ready;
    const ref = await writer.put(Buffer.from("synthetic screenshot bytes"), { mediaType: "image/png" });
    database.authority.diagnosticBundles.insert({ bundleId: randomUUID(), runId: run.envelope.runId,
      origin: { kind: "operator-request", requestedBy: "local-operator" }, createdAt: NOW, contentDigest: HASH_A,
      configFingerprint: run.envelope.configFingerprint, descriptorFingerprint: run.envelope.contractFingerprint,
      redaction: { fields: [], warnings: [] }, retention: { kind: "ordinary", purgeAfter: "2026-12-01T00:00:00.000Z" },
      attachments: [{ kind: "screenshot", artifactId: ref.id, mediaType: ref.mediaType, byteLength: ref.bytes, digest: ref.sha256,
        sensitivity: "redacted", width: 1, height: 1 }] });
    return join(profile.admission.artifactRoot, `${ref.sha256}.artifact`);
  };
  const ordinary = async (run: ReturnType<typeof seed>, shared?: ArtifactRef, nodeId = "render-page") => {
    const writer = createContentAddressedArtifactWriter({ admission: profile.admission }); await writer.ready;
    const ref = shared ?? await writer.put(Buffer.from(`ordinary rendered page ${run.envelope.runId} ${nodeId}`), { mediaType: "image/png" });
    const output = ExtractPdfPagesOutputSchema.parse({ pageCount: 1, pages: [{ sourcePage: 1, image: ref }] });
    const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
      runId: run.envelope.runId, nodeId, attempt: run.envelope.attempt, claimGeneration: 1,
      output: { schemaHash: HASH_A, value: output }, descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint, implFingerprint: HASH_A, provenance: [], writtenAt: NOW });
    database.authority.runCheckpoints.insert(checkpoint);
    return { ref, checkpoint, file: join(profile.admission.artifactRoot, `${ref.sha256}.artifact`) };
  };
  const rows = (table: string) => {
    using raw = new DatabaseSync(profile.path, { readOnly: true });
    return raw.prepare(`SELECT * FROM ${table}`).all();
  };
  return { profile, get database() { return database; }, service, lifecycle, seed, diagnostic, ordinary, rows,
    get refreshed() { return refreshed; },
    fault(step?: string, at = 1) { failStep = step; faultAt = at; matchedSteps = 0; }, fileFault(value: boolean) { fileFault = value; },
    reopen() { database.close(); database = open(); },
  };
}

describe("clear all run history", () => {
  it("clears roots and delegated descendants with logs and screenshot files, preserving ordinary authority", async () => {
    const f = await fixture();
    const root = f.seed(); const child = f.seed(UUID_3, root); f.seed(UUID_5);
    const file = await f.diagnostic(root);
    expect(await f.diagnostic(child)).toBe(file);
    const library = createWorkbookLibraryService({ repository: f.database.authority.workbooks, clock: capturedInstantClock(NOW), sync: unexpectedWorkbookSync });
    const workbook = library.create({ name: "Retained.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Sheet", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "Retained" }] }] }] });
    const retained = ["settings", "settings_snapshots", "artifacts", "workbook_types", "workbook_library", "workbook_library_history", "workbook_operations", "workbook_creations", "workbook_library_state", "write_intents", "write_attempts"];
    const credentialFile = join(f.profile.stateRoot, "credentials", "protected.json"), credentials = readFileSync(credentialFile);
    const account = f.profile.machine.readProfileRegistry();
    const before = retained.map(table => [table, f.rows(table)]);
    const command = request();
    expect(f.service().status()).toEqual({ state: "available", finishedRuns: 3, activeRuns: 0 });
    expect(f.service().clear(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 3 });
    expect(f.refreshed).toBe(1);
    expect(existsSync(file)).toBe(false);
    for (const table of ["runs", "timeline_events", "diagnostic_files", "diagnostic_snapshots", "run_results", "run_receipts", "run_checkpoints", "run_search"]) expect(f.rows(table)).toEqual([]);
    expect(f.rows("deleted_runs")).toHaveLength(3);
    expect(f.rows("deleted_runs").every(row => deletedRunFromRow(row).receipt.origin === "storage")).toBe(true);
    expect(f.rows("deleted_runs").every(row => row.cleanup_state === "complete")).toBe(true);
    expect(retained.map(table => [table, f.rows(table)])).toEqual(before);
    expect(library.read(workbook.libraryId)).toEqual(workbook);
    expect(readFileSync(credentialFile)).toEqual(credentials);
    expect(f.profile.machine.readProfileRegistry()).toEqual(account);
    using raw = new DatabaseSync(f.profile.path, { readOnly: true });
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    f.reopen();
    expect(f.service().status()).toEqual({ state: "available", finishedRuns: 0, activeRuns: 0 });
    const generation = f.database.getMeta().authorityGeneration;
    expect(f.service().clear(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 3 });
    expect(f.database.getMeta().authorityGeneration).toBe(generation);
    const later = f.seed();
    expect(f.service().clear(command).state).toBe("cleared");
    expect(f.database.authority.runs.get(later.envelope.runId)).toBeDefined();
  });

  it("refuses the whole operation if an active run appears after the status read", async () => {
    const f = await fixture(); const finished = f.seed();
    expect(f.service().status()).toMatchObject({ activeRuns: 0 });
    f.seed(undefined, finished, false);
    const command = request(), before = f.rows("runs"), generation = f.database.getMeta().authorityGeneration;
    expect(f.service().clear(command)).toEqual({ state: "refused", commandId: command.commandId, reason: "active-runs" });
    expect(f.rows("runs")).toEqual(before);
    expect(f.rows("deleted_runs")).toEqual([]);
    expect(f.database.authority.lifecycleJournal.getCommand(command.commandId)).toBeUndefined();
    expect(f.database.getMeta().authorityGeneration).toBe(generation);
  });

  it.each(["tombstone", "runs", "cascade-complete"])("rolls back all database and file effects after %s", async step => {
    const f = await fixture(); const root = f.seed(); f.seed(); const file = await f.diagnostic(root);
    const command = request(), before = f.rows("runs"), bytes = readFileSync(file), generation = f.database.getMeta().authorityGeneration;
    f.fault(step, 2);
    expect(() => f.service().clear(command)).toThrow("history-delete-fault");
    expect(f.rows("runs")).toEqual(before);
    expect(f.rows("deleted_runs")).toEqual([]);
    expect(f.database.authority.lifecycleJournal.getCommand(command.commandId)).toBeUndefined();
    expect(f.database.getMeta().authorityGeneration).toBe(generation);
    expect(readFileSync(file)).toEqual(bytes);
  });

  it("resumes the exact manifest after an unlink fault without touching a later run", async () => {
    const f = await fixture(); const root = f.seed(); const file = await f.diagnostic(root); const command = request();
    f.fileFault(true);
    expect(() => f.service().clear(command)).toThrow("history-file-fault");
    expect(existsSync(file)).toBe(false);
    expect(f.rows("deleted_runs")[0]?.cleanup_state).toBe("pending");
    f.fileFault(false); f.reopen(); const later = f.seed();
    expect(f.service().check(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 1 });
    expect(f.database.authority.runs.get(later.envelope.runId)).toBeDefined();
    expect(f.rows("deleted_runs")[0]?.cleanup_state).toBe("complete");
  });

  it("refuses changed screenshot bytes after commit until exact original bytes return", async () => {
    const f = await fixture(); const root = f.seed(); const file = await f.diagnostic(root); const bytes = readFileSync(file);
    const command = request();
    expect(f.lifecycle().clearHistory(command).state).toBe("cleared");
    writeFileSync(file, Buffer.concat([bytes, Buffer.from("\n")]));
    expect(() => f.service().clear(command)).toThrow("artifact-deletion-captured-bytes-mismatch");
    expect(f.rows("deleted_runs")[0]?.cleanup_state).toBe("pending");
    writeFileSync(file, bytes);
    expect(f.service().clear(command).state).toBe("cleared");
    expect(existsSync(file)).toBe(false);
  });

  it("journals an empty clear once and replays it without clearing later runs", async () => {
    const f = await fixture(); const command = request();
    expect(f.service().clear(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 0 });
    const run = f.seed();
    expect(f.service().clear(command)).toMatchObject({ state: "cleared", deletedRuns: 0 });
    expect(f.database.authority.runs.get(run.envelope.runId)).toBeDefined();
  });

  it.each(["complete", "restart-pending"])("retains confirmed write evidence and transaction history through clear and reopen: %s", async cleanup => {
    const w = await historyWorld({ terminalize: true });
    try {
      const admission = findProfileFixtureAdmission(dirname(w.path)); if (admission === undefined) throw new Error("missing fixture admission");
      const writer = createContentAddressedArtifactWriter({admission}); await writer.ready;
      const ref = await writer.put(Buffer.from("retained HR write proof"), {mediaType: "application/pdf"});
      const confirmed = w.commit(801, {proof: {schemaHash: HASH_A, value: {artifact: ref}}}); w.commit(802);
      const run = w.database.authority.runs.get(confirmed.commit.transaction.runId); if (run === undefined) throw new Error("missing committed fixture run");
      w.database.authority.runCheckpoints.insert({workflowId: run.envelope.workflow, itemId: run.envelope.itemId, runId: run.envelope.runId,
        nodeId: "artifact-proof", attempt: run.envelope.attempt, claimGeneration: 1, output: {schemaHash: HASH_A, value: {artifact: ref}},
        descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint, implFingerprint: HASH_A, provenance: [], writtenAt: HISTORY_NOW});
      if (cleanup === "restart-pending") for (const nodeId of ["first", "second"]) {
        const artifact = await writer.put(Buffer.from(`restart cleanup ${nodeId}`), {mediaType: "image/png"});
        w.database.authority.runCheckpoints.insert({workflowId: run.envelope.workflow, itemId: run.envelope.itemId, runId: run.envelope.runId,
          nodeId, attempt: run.envelope.attempt, claimGeneration: 1, output: {schemaHash: HASH_A, value: {artifact}},
          descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint, implFingerprint: HASH_A, provenance: [], writtenAt: HISTORY_NOW});
      }
      const permanent = () => {
        using raw = new DatabaseSync(w.path, { readOnly: true });
        return ["write_intents", "write_attempts"].map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
      };
      const before = permanent(), command = request();
      const lifecycle = new RunRecordService({ database: w.database, clock: capturedInstantClock(HISTORY_NOW), ids: sequentialIdFactory(), publishQueued() {} });
      for (const run of w.database.authority.runs.listByWorkflow(personLookupDescriptor.id)) {
        const cancelled = lifecycle.transition({ commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: HISTORY_NOW } });
        if (cancelled.state !== "applied" || !("workerId" in cancelled.run.lifecycle)) throw new Error("fixture cancellation refused");
        expect(lifecycle.terminalize({ kind: "cancelled", commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: cancelled.run.version,
          claim: { workerId: cancelled.run.lifecycle.workerId, claimGeneration: cancelled.run.claimGeneration }, endedAt: HISTORY_NOW }, personLookupDescriptor).state).toBe("applied");
      }
      if (cleanup === "restart-pending") {
        expect(lifecycle.clearHistory(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 3 });
        let files;
        {
          using raw = new DatabaseSync(w.path, { readOnly: true });
          files = deletedRunFromRow(raw.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(run.envelope.runId)).files.filter(file => file.disposition === "remove");
        }
        expect(files).toHaveLength(2);
        const first = files[0], second = files[1]; if (first === undefined || second === undefined) throw new Error("missing cleanup fixture files");
        expect(removeArtifactDeletionFile(admission, first)).toBe("removed");
        expect(existsSync(join(admission.artifactRoot, `${second.ref.sha256}.artifact`))).toBe(true);
        w.reopen();
        const reconstructed = createRunHistoryService({database: w.database,
          lifecycle: new RunRecordService({ database: w.database, clock: capturedInstantClock(HISTORY_NOW), ids: sequentialIdFactory(), publishQueued() {} }), afterClear() {}});
        expect(reconstructed.status()).toEqual({state: "available", finishedRuns: 0, activeRuns: 0});
        for (const file of files) expect(existsSync(join(admission.artifactRoot, `${file.ref.sha256}.artifact`))).toBe(false);
      } else {
        const service = createRunHistoryService({ database: w.database, lifecycle, afterClear() {} });
        expect(service.clear(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 3 });
      }
      expect(permanent()).toEqual(before);
      expect(existsSync(join(admission.artifactRoot, `${ref.sha256}.artifact`))).toBe(true);
      expect(w.database.readManagedArtifactReferences()).toContainEqual(ref);
      {
        using raw = new DatabaseSync(w.path, { readOnly: true });
        const manifest = deletedRunFromRow(raw.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(run.envelope.runId));
        expect(manifest.cleanupState).toBe("complete");
        expect(manifest.files).toContainEqual(expect.objectContaining({ ref, disposition: "retain" }));
      }
      expect(w.history.query({ from: "2026-07-01", to: "2026-12-01" }).rows).toHaveLength(2);
      w.reopen(); expect(permanent()).toEqual(before);
      expect(existsSync(join(admission.artifactRoot, `${ref.sha256}.artifact`))).toBe(true);
      expect(w.history.query({ from: "2026-07-01", to: "2026-12-01" }).rows).toHaveLength(2);
    } finally { await w.dispose(); }
  });
});

it("removes a rendered page referenced only by a delegated child checkpoint, without diagnostic attachments", async () => {
  const f = await fixture(); const root = f.seed(), child = f.seed(undefined, root);
  const {ref, file} = await f.ordinary(child);
  expect(f.rows("diagnostic_files")).toEqual([]);
  expect(existsSync(file)).toBe(true);
  expect(f.service().clear(request())).toMatchObject({state: "cleared", deletedRuns: 2});
  expect(existsSync(file)).toBe(false);
  const tombstone = f.rows("deleted_runs").map(deletedRunFromRow).find(row=>row.receipt.runId===child.envelope.runId);
  expect(tombstone?.files).toMatchObject([{ref, disposition: "remove"}]);
  f.reopen(); expect(existsSync(file)).toBe(false);
  expect(f.database.readManagedArtifactReferences()).not.toContainEqual(ref);
});

it("checks an absent journal without deleting a later terminal run or writing a command", async () => {
  const f = await fixture(); const original = f.seed(); const unreceived = request();
  const later = f.seed(); const before = f.rows("runs"), generation = f.database.getMeta().authorityGeneration;
  expect(f.service().check(unreceived)).toEqual({ state: "not-recorded", commandId: unreceived.commandId });
  expect(f.rows("runs")).toEqual(before);
  expect(f.database.authority.runs.get(original.envelope.runId)).toBeDefined();
  expect(f.database.authority.runs.get(later.envelope.runId)).toBeDefined();
  expect(f.rows("deleted_runs")).toEqual([]);
  expect(f.database.authority.lifecycleJournal.getCommand(unreceived.commandId)).toBeUndefined();
  expect(f.database.getMeta().authorityGeneration).toBe(generation);
});

it("recovers a committed response loss without clearing later runs", async () => {
  const f = await fixture(); f.seed(); const command = request();
  expect(f.service().clear(command)).toMatchObject({state: "cleared", deletedRuns: 1});
  f.reopen(); const later = f.seed(); const generation = f.database.getMeta().authorityGeneration;
  expect(f.service().check(command)).toEqual({state: "cleared", commandId: command.commandId, deletedRuns: 1});
  expect(f.database.authority.runs.get(later.envelope.runId)).toBeDefined();
  expect(f.database.getMeta().authorityGeneration).toBe(generation);
});

it("keeps an ordinary artifact while another run consumes it, then removes it with the last consumer", async () => {
  const f = await fixture(); const first = f.seed(), second = f.seed();
  const { ref, file } = await f.ordinary(first); await f.ordinary(second, ref);
  const command = request();
  expect(f.lifecycle().delete({ commandId: command.commandId, runId: first.envelope.runId, expectedVersion: first.version }).state).toBe("deleted");
  f.database.settleRunDeletionFiles({ runId: first.envelope.runId, commandId: command.commandId });
  expect(existsSync(file)).toBe(true);
  expect(deletedRunFromRow(f.rows("deleted_runs")[0]).files).toMatchObject([{ ref, disposition: "retain" }]);
  f.reopen(); expect(existsSync(file)).toBe(true);
  expect(f.service().clear(request())).toMatchObject({state: "cleared", deletedRuns: 1});
  expect(existsSync(file)).toBe(false);
  expect(f.database.readManagedArtifactReferences()).not.toContainEqual(ref);
});

it.each(["library-source", "generated-publication", "generated-identity"])("keeps an ordinary artifact with a retained %s consumer", async consumer => {
  const f = await fixture(); const root = f.seed(); const {ref, file} = await f.ordinary(root);
  const library = createWorkbookLibraryService({repository: f.database.authority.workbooks, clock: capturedInstantClock(NOW), sync: unexpectedWorkbookSync});
  const workbook = library.create({name: "Source.xlsx", themes: [], hasFormulas: false, sheets: [{id: "sheet", name: "Sheet", width: 1, hidden: [], rows: [{id: "row", cells: [{value: "Retained"}]}]}]});
  if (consumer === "library-source") f.database.authority.intakeSessions.create({reservedManifestId: randomUUID(), intakeSessionId: randomUUID(), actorId: "local-operator", workflow: root.envelope.workflow,
    artifact: ref, workbookSource: {libraryId: workbook.libraryId, version: workbook.version}, sheet: "Sheet", headerRowIndex: 0,
    bindings: [], constants: [], corrections: [], exclusions: [], state: "mapping", validation: {state: "none"}, version: 1, createdAt: NOW, updatedAt: NOW});
  else f.database.authority.artifactOutbox.insert({outboxId: randomUUID(), artifactId: ref.id, projectionId: "retained-publication", stableKeyFingerprint: HASH_A,
    keyValues: [{field: "subject", value: "synthetic"}], sinkId: "xlsx-retention", sourceRunId: root.envelope.runId, sourceNodeId: "render-page",
    state: "pending", payload: {schemaHash: HASH_A, value: consumer === "generated-identity" ? {subject: "synthetic"} : {artifact: ref}}, createdAt: NOW});
  const before = f.rows("artifacts");
  expect(f.service().clear(request())).toMatchObject({state: "cleared", deletedRuns: 1});
  expect(existsSync(file)).toBe(true);
  expect(f.rows("artifacts")).toEqual(before);
  expect(library.read(workbook.libraryId)).toEqual(workbook);
  expect(deletedRunFromRow(f.rows("deleted_runs")[0]).files).toMatchObject([{ref, disposition: "retain"}]);
  f.reopen(); expect(existsSync(file)).toBe(true); expect(f.database.readManagedArtifactReferences()).toContainEqual(ref);
});

it("preserves ordinary files and their owners when a later root fails before commit", async () => {
  const f = await fixture(); const root = f.seed(), child = f.seed(undefined, root); const {ref, file} = await f.ordinary(child);
  const bytes = readFileSync(file), runs = f.rows("runs"), command = request(); f.fault("runs", 2);
  expect(()=>f.service().clear(command)).toThrow("history-delete-fault");
  expect(f.rows("runs")).toEqual(runs); expect(f.rows("deleted_runs")).toEqual([]); expect(readFileSync(file)).toEqual(bytes);
  f.fault(); f.reopen(); expect(f.database.readManagedArtifactReferences()).toContainEqual(ref);
  expect(f.service().clear(command)).toMatchObject({state: "cleared", deletedRuns: 2}); expect(existsSync(file)).toBe(false);
});

it("recovers a delegated ordinary artifact manifest after unlink failure and reopen without deleting later evidence", async () => {
  const f = await fixture(); const root = f.seed(), child = f.seed(undefined, root); const {ref, file} = await f.ordinary(child); const command = request();
  f.fileFault(true); expect(()=>f.service().clear(command)).toThrow("history-file-fault");
  expect(existsSync(file)).toBe(false);
  const pending = f.rows("deleted_runs").map(deletedRunFromRow).find(row=>row.receipt.runId===child.envelope.runId);
  expect(pending?.cleanupState).toBe("pending"); expect(pending?.files).toMatchObject([{ref, disposition: "remove"}]);
  f.fileFault(false); f.reopen(); const later = f.seed(), evidence = await f.ordinary(later);
  expect(f.service().check(command)).toEqual({state: "cleared", commandId: command.commandId, deletedRuns: 2});
  expect(f.database.authority.runs.get(later.envelope.runId)).toBeDefined(); expect(existsSync(evidence.file)).toBe(true);
  expect(f.rows("deleted_runs").every(row=>deletedRunFromRow(row).cleanupState==="complete")).toBe(true);
  expect(existsSync(file)).toBe(false);
});

it("rejects replaced ordinary artifact bytes and recovers only the originally captured manifest", async () => {
  const f = await fixture(); const root = f.seed(), {ref, file} = await f.ordinary(root); const bytes = readFileSync(file), command = request();
  expect(f.lifecycle().clearHistory(command).state).toBe("cleared");
  const manifest = f.rows("deleted_runs"); writeFileSync(file, Buffer.concat([bytes, Buffer.from("\n")]));
  expect(()=>f.service().check(command)).toThrow("artifact-deletion-captured-bytes-mismatch");
  expect(f.rows("deleted_runs")).toEqual(manifest);
  expect(()=>f.reopen()).toThrow("artifact-deletion-captured-bytes-mismatch");
  expect(f.rows("deleted_runs")).toEqual(manifest);
  writeFileSync(file, bytes); f.reopen(); expect(f.service().check(command).state).toBe("cleared"); expect(existsSync(file)).toBe(false);
  expect(f.database.readManagedArtifactReferences()).not.toContainEqual(ref);
});

it("clears already-purged diagnostics without treating their receipt as a live artifact", async () => {
  const f = await fixture(); const root = f.seed(), file = await f.diagnostic(root);
  expect(f.database.sweepOrdinaryDiagnostics("2027-01-01T00:00:00.000Z").purged).toHaveLength(1);
  expect(existsSync(file)).toBe(false);
  expect(f.service().clear(request())).toMatchObject({state: "cleared", deletedRuns: 1});
  expect(f.rows("deleted_runs").map(deletedRunFromRow)[0]?.files).toEqual([]);
});

it("does not let purged diagnostics on a retained run pin a live ordinary artifact", async () => {
  const f = await fixture(); const first = f.seed(), retained = f.seed();
  const file = await f.diagnostic(retained);
  const ref = z.object({ref: ArtifactRefSchema}).parse(JSON.parse(readFileSync(file, "utf8"))).ref;
  await f.ordinary(first, ref);
  expect(f.database.sweepOrdinaryDiagnostics("2027-01-01T00:00:00.000Z").purged).toHaveLength(1);
  expect(existsSync(file)).toBe(true);
  const command = request();
  expect(f.lifecycle().delete({commandId: command.commandId, runId: first.envelope.runId, expectedVersion: first.version}).state).toBe("deleted");
  expect(f.database.settleRunDeletionFiles({runId: first.envelope.runId, commandId: command.commandId})).toBe("complete");
  expect(existsSync(file)).toBe(false);
  expect(f.database.authority.runs.get(retained.envelope.runId)).toBeDefined();
});

it.each(["before-unlink", "partly-removed"])("recovers %s manifests on runtime reconstruction without the browser command", async interruption => {
  const f = await fixture(), root = f.seed(), child = f.seed(undefined, root);
  const first = await f.ordinary(child, undefined, "first"), second = await f.ordinary(child, undefined, "second");
  const retained = await f.ordinary(root);
  const library = createWorkbookLibraryService({repository: f.database.authority.workbooks, clock: capturedInstantClock(NOW), sync: unexpectedWorkbookSync});
  const workbook = library.create({name: "Retained.xlsx", themes: [], hasFormulas: false, sheets: [{id: "sheet", name: "Sheet", width: 1, hidden: [], rows: [{id: "row", cells: [{value: "Retained"}]}]}]});
  f.database.authority.intakeSessions.create({reservedManifestId: randomUUID(), intakeSessionId: randomUUID(), actorId: "local-operator", workflow: root.envelope.workflow,
    artifact: retained.ref, workbookSource: {libraryId: workbook.libraryId, version: workbook.version}, sheet: "Sheet", headerRowIndex: 0,
    bindings: [], constants: [], corrections: [], exclusions: [], state: "mapping", validation: {state: "none"}, version: 1, createdAt: NOW, updatedAt: NOW});
  if (interruption === "partly-removed") {
    f.fileFault(true);
    expect(() => f.service().clear(request())).toThrow("history-file-fault");
    f.fileFault(false);
  } else expect(f.lifecycle().clearHistory(request())).toMatchObject({state: "cleared", deletedRuns: 2});
  const original = f.rows("deleted_runs").map(deletedRunFromRow);
  expect(original.some(manifest => manifest.cleanupState === "pending")).toBe(true);
  expect([first, second].filter(artifact => existsSync(artifact.file))).toHaveLength(interruption === "partly-removed" ? 1 : 2);
  const later = f.seed(); const laterFile = await f.ordinary(later); await f.ordinary(later, retained.ref, "shared-library");
  const before = ["runs", "commands", "command_audits", "artifacts", "workbook_library"].map(table => [table, f.rows(table)]);
  f.reopen();
  const reconstructed = f.service();
  expect(reconstructed.status()).toEqual({state: "available", finishedRuns: 1, activeRuns: 0});
  expect([first, second].every(artifact => !existsSync(artifact.file))).toBe(true);
  expect(existsSync(retained.file)).toBe(true); expect(existsSync(laterFile.file)).toBe(true);
  expect(["runs", "commands", "command_audits", "artifacts", "workbook_library"].map(table => [table, f.rows(table)])).toEqual(before);
  const completed = f.rows("deleted_runs").map(deletedRunFromRow);
  expect(completed.map(({cleanupState: _state, ...manifest}) => manifest)).toEqual(original.map(({cleanupState: _state, ...manifest}) => manifest));
  expect(completed.every(manifest => manifest.cleanupState === "complete")).toBe(true);
  const inventory = f.database.readProfileResourceCustody().artifactReferences;
  expect(inventory).toContainEqual(retained.ref); expect(inventory).toContainEqual(laterFile.ref);
  expect(inventory).not.toContainEqual(first.ref); expect(inventory).not.toContainEqual(second.ref);
  f.reopen(); expect(f.service().status()).toMatchObject({finishedRuns: 1});
});

it("inventories only still-present pending files after a partial unlink, preserving the exact manifest", async () => {
  const f = await fixture(), root = f.seed();
  const first = await f.ordinary(root, undefined, "first"), second = await f.ordinary(root, undefined, "second");
  f.fileFault(true); expect(() => f.service().clear(request())).toThrow("history-file-fault"); f.fileFault(false);
  const manifest = f.rows("deleted_runs").map(deletedRunFromRow);
  expect(manifest[0]?.files).toHaveLength(2); expect(manifest[0]?.cleanupState).toBe("pending");
  const present = [first, second].filter(artifact => existsSync(artifact.file));
  expect(present).toHaveLength(1);
  expect(f.database.readManagedArtifactReferences()).toEqual(present.map(artifact => artifact.ref));
  expect(f.database.readProfileResourceCustody().artifactReferences).toEqual(present.map(artifact => artifact.ref));
  const membership = enumerateProfileCredentialMembership(f.profile.admission, f.database.readProfileResourceCustody(), join(f.profile.stateRoot, "browsers"), {
    workerDirectory() { throw new Error("no fixture browser membership"); },
  });
  expect(membership.identities.filter(entry => entry.path.endsWith(".artifact")).map(entry => entry.path)).toEqual(present.map(artifact => artifact.file));
  expect(f.rows("deleted_runs").map(deletedRunFromRow)).toEqual(manifest);
});

it("keeps read-only inspection passive and never sweeps unowned files during reconstruction", async () => {
  const f = await fixture(), root = f.seed(), artifact = await f.ordinary(root);
  expect(f.lifecycle().clearHistory(request()).state).toBe("cleared");
  const unknown = join(f.profile.admission.artifactRoot, `${"f".repeat(64)}.artifact`);
  writeFileSync(unknown, "unowned bytes", {mode: 0o600});
  using inspection = AuthorityDatabase.open({path: f.profile.path, busyTimeoutMs: 250, migrationOwner: "history-read-only-test", openMode: "storage-doctor-read-only-no-migrate"});
  expect(existsSync(artifact.file)).toBe(true);
  expect(f.rows("deleted_runs").map(deletedRunFromRow)[0]?.cleanupState).toBe("pending");
  inspection.close(); f.reopen();
  expect(existsSync(artifact.file)).toBe(false); expect(readFileSync(unknown, "utf8")).toBe("unowned bytes");
  expect(() => enumerateProfileCredentialMembership(f.profile.admission, f.database.readProfileResourceCustody(), join(f.profile.stateRoot, "browsers"), {
    workerDirectory() { throw new Error("no fixture browser membership"); },
  })).toThrow("profile-inventory-artifact-unowned");
});

it("discovers pending cleanup from status after browser request state is discarded", async () => {
  const f = await fixture(), root = f.seed();
  const first = await f.ordinary(root, undefined, "first"), second = await f.ordinary(root, undefined, "second");
  f.fileFault(true); expect(() => f.service().clear(request())).toThrow("history-file-fault");
  expect(() => f.service().status()).toThrow("history-file-fault");
  const before = ["commands", "command_audits"].map(table => f.rows(table)), refreshed = f.refreshed;
  expect([first, second].filter(artifact => existsSync(artifact.file))).toHaveLength(1);
  f.fileFault(false);
  expect(f.service().status()).toEqual({state: "available", finishedRuns: 0, activeRuns: 0});
  expect(f.refreshed).toBe(refreshed + 1);
  expect([first, second].every(artifact => !existsSync(artifact.file))).toBe(true);
  expect(f.rows("deleted_runs").map(deletedRunFromRow).every(manifest => manifest.cleanupState === "complete")).toBe(true);
  expect(["commands", "command_audits"].map(table => f.rows(table))).toEqual(before);
});

it("does not reuse completed removal metadata for a later file with identical content", async () => {
  const f = await fixture(), root = f.seed();
  const writer = createContentAddressedArtifactWriter({admission: f.profile.admission}); await writer.ready;
  const bytes = Buffer.from("identical content after completed cleanup"), original = await writer.put(bytes, {mediaType: "image/png"});
  await f.ordinary(root, original); expect(f.service().clear(request()).state).toBe("cleared");
  const replacement = await writer.put(bytes, {mediaType: "image/png"});
  expect(replacement.sha256).toBe(original.sha256); expect(replacement.id).not.toBe(original.id);
  const later = f.seed(); const retained = await f.ordinary(later, replacement);
  expect(f.database.readManagedArtifactReferences()).toEqual([replacement]);
  f.reopen(); expect(existsSync(retained.file)).toBe(true); expect(f.database.readManagedArtifactReferences()).toEqual([replacement]);
});
