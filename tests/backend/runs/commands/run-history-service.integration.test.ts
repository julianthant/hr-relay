import { deletedRunFromRow } from "../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createRunHistoryService } from "../../../../src/backend/runs/commands/run-history-service.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
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
  const rows = (table: string) => {
    using raw = new DatabaseSync(profile.path, { readOnly: true });
    return raw.prepare(`SELECT * FROM ${table}`).all();
  };
  return { profile, get database() { return database; }, service, lifecycle, seed, diagnostic, rows,
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
    expect(f.service().clear(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 1 });
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

  it("retains confirmed write evidence and transaction history through clear and reopen", async () => {
    const w = await historyWorld({ terminalize: true });
    try {
      w.commit(801); w.commit(802);
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
      expect(lifecycle.clearHistory(command)).toEqual({ state: "cleared", commandId: command.commandId, deletedRuns: 3 });
      expect(permanent()).toEqual(before);
      expect(w.history.query({ from: "2026-07-01", to: "2026-12-01" }).rows).toHaveLength(2);
      w.reopen(); expect(permanent()).toEqual(before);
      expect(w.history.query({ from: "2026-07-01", to: "2026-12-01" }).rows).toHaveLength(2);
    } finally { await w.dispose(); }
  });
});
