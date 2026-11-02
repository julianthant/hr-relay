import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION } from "../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService, type WorkbookSyncDownload } from "../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const databases: DatabaseSync[] = [];
const signal = () => new AbortController().signal;
const at = "2026-11-02T00:00:00.000Z";
const link = { url: "https://tenant.sharepoint.com/sites/hr/Documents/Roster.csv", verifiedAt: at };
const bytes = () => new TextEncoder().encode("EID,Notes\n001,remote\n002,new\n").buffer;
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture(sync: WorkbookSyncDownload) {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements]) database.exec(statement);
  const transaction = <Result>(work: () => Result): Result => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = work(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
  const service = createWorkbookLibraryService({ repository, clock: manualClock(new Date(at)), sync });
  const initial = service.create({ name: "Roster.csv", themes: [], hasFormulas: false,
    sheets: [{ id: "source", name: "Sheet 1", width: 2, hidden: [], headerRow: 1,
      columnBindings: ["eid", "roster.notes"].map((fieldId, index) => ({ id: `c${index}`, sourceColumn: index,
        sourceHeader: index === 0 ? "EID" : "Notes", fieldId, basis: "manual" })),
      rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Notes" }] },
        { id: "person", cells: [{ value: "001" }, { value: "" }] }] }] });
  service.putType({ id: "roster", name: "Roster", keyFieldId: "eid", fields: ["eid", "roster.notes"], defaultWorkbookId: null });
  service.operatorOperation(initial.libraryId, "link", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "roster", sharePoint: link } });
  return { service, repository, id: initial.libraryId };
}

it("settles a downloaded master only after browser closure, preserves operator clears and replays without another download", async () => {
  let downloads = 0, browserClosed = false;
  const f = fixture({ async withDownload(command, use) {
    downloads++;
    expect(command).toMatchObject({ libraryId: f.id, operationId: "sync", expectedVersion: 3, link });
    browserClosed = true;
    return use({ name: "Roster.csv", bytes: bytes() }, { signal: command.signal, assertCurrent: () => { expect(browserClosed).toBe(true); } });
  } });
  const live = f.service.read(f.id), changed = structuredClone(live.workbook);
  changed.sheets[0].rows[1].cells[1].value = null;
  f.service.save(f.id, live.version, changed);
  const receipt = await f.service.sync(f.id, "sync", signal());
  expect(receipt).toMatchObject({ state: "applied", version: 4, source: { kind: "sync", syncId: "sync" } });
  const current = f.service.read(f.id);
  expect(current.workbook.sheets[0].rows[1].cells[1].value).toBe(null);
  expect(current.workbook.sheets[0].rows[2].cells.map(cell => cell.value)).toEqual(["002", "new"]);
  expect(f.service.versions(f.id)).toEqual([]);
  expect(await f.service.sync(f.id, "sync", signal())).toEqual(receipt);
  expect(downloads).toBe(1);
});

it("keeps concurrent metadata edits and settles a version conflict against the captured master", async () => {
  const f = fixture({ async withDownload(command, use) {
    f.service.operatorOperation(f.id, "unlink", { kind: "metadata", expectedVersion: 2, metadata: { typeId: "roster", sharePoint: null } });
    return use({ name: "Roster.csv", bytes: bytes() }, { signal: command.signal, assertCurrent: () => command.signal.throwIfAborted() });
  } });
  const before = f.service.read(f.id).workbook;
  expect(await f.service.sync(f.id, "sync", signal())).toMatchObject({ state: "refused", reason: "version-conflict", version: 3, changes: [] });
  expect(f.service.read(f.id).workbook).toEqual(before);
  expect(f.service.metadata(f.id).sharePoint).toBe(null);
});

it.each(["abort", "revoked", "download", "parse"] as const)("keeps the master and journal unchanged after %s failure", async failure => {
  const controller = new AbortController();
  const f = fixture({ async withDownload(command, use) {
    if (failure === "download") throw new Error("fake transfer failed");
    if (failure === "abort") controller.abort();
    return use({ name: failure === "parse" ? "Roster.xlsx" : "Roster.csv", bytes: failure === "parse" ? new ArrayBuffer(1) : bytes() }, {
      signal: command.signal, assertCurrent: () => {
        command.signal.throwIfAborted();
        if (failure === "revoked") throw new Error("fake command revoked");
      },
    });
  } });
  const before = f.service.read(f.id), journal = f.service.journal(f.id);
  await expect(f.service.sync(f.id, "sync", controller.signal)).rejects.toThrow();
  expect(f.service.read(f.id)).toEqual(before);
  expect(f.service.journal(f.id)).toEqual(journal);
});

it("rejects a missing link and an operation identity collision before downloading", async () => {
  let downloads = 0;
  const f = fixture({ withDownload: () => { downloads++; throw new Error("must not download"); } });
  await expect(f.service.sync(f.id, "link", signal())).rejects.toMatchObject({ code: "WORKBOOK_OPERATION_CONFLICT" });
  f.service.operatorOperation(f.id, "unlink", { kind: "metadata", expectedVersion: 2, metadata: { typeId: "roster", sharePoint: null } });
  await expect(f.service.sync(f.id, "sync", signal())).rejects.toMatchObject({ code: "WORKBOOK_SYNC_LINK_REQUIRED" });
  expect(downloads).toBe(0);
});

it.each(["hasFormulas", "unsupportedMetadata"] as const)("refuses a stored %s master before download", async flag => {
  let downloads = 0;
  const f = fixture({ withDownload: () => { downloads++; throw new Error("must not download"); } });
  const unsafe = f.service.create({ ...f.service.read(f.id).workbook, libraryId: undefined, [flag]: true });
  f.service.operatorOperation(unsafe.libraryId, "link", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "roster", sharePoint: link } });
  const before = f.service.read(unsafe.libraryId), journal = f.service.journal(unsafe.libraryId);
  await expect(f.service.sync(unsafe.libraryId, "sync", signal())).rejects.toMatchObject({ code: "WORKBOOK_METADATA_UNSUPPORTED" });
  expect(f.service.read(unsafe.libraryId)).toEqual(before);
  expect(f.service.journal(unsafe.libraryId)).toEqual(journal);
  expect(downloads).toBe(0);
});
