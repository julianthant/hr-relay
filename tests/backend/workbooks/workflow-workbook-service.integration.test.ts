import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterEach, expect, it } from "vitest";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION } from "../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkflowWorkbookService } from "../../../src/backend/workbooks/workflow-workbook-service.js";
import { WorkbookLibraryError } from "../../../src/backend/workbooks/workbook-library-service.js";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { WorkflowWorkbookCommandSchema, type WorkflowWorkbookCommand } from "../../../src/models/processing/workbooks/read-result.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { i9CheckWorkbookTable } from "../../../src/rules/i9-check/workbook.js";
import { i9MatchOutcome, i9RetentionRow } from "../../../src/rules/i9-check/retention.js";
import { i9Candidate, i9CheckInput } from "../../support/fixtures/i9-check.js";
import { createWorkbookLibraryAdapter } from "../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createProviderClient } from "../../../src/backend/processing/providers/provider-client.js";
import { readWorkbookResultTask } from "../../../src/backend/processing/workbooks/tasks/read-result.js";
import { ReadWorkbookResult } from "../../../src/models/processing/workbooks/read-result.js";
import { createTaskProvenanceCollector } from "../../../src/backend/runs/provenance/task-provenance.js";
import { compileFixtureWorkflow } from "../../support/fixtures/workflow-definition-fixtures.js";
import { createSearchWorkflowDefinitionFixtures } from "../../support/helpers/search-workflow-definition-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const runId = "00000000-0000-4000-8000-000000000001";
const nextRun = "00000000-0000-4000-8000-000000000002";
const signal = new AbortController().signal;
const table = i9CheckWorkbookTable([i9RetentionRow({ input: i9CheckInput, initial: i9MatchOutcome({ hits: [], confirmed: [i9Candidate], dropped: [] }) }).row]);
const command = (): WorkflowWorkbookCommand => WorkflowWorkbookCommandSchema.parse({ operationKey: "results", target: { kind: "create", name: "I-9 results" }, source: { kind: "table", table } });
function fixture(bytes = Buffer.alloc(0)) {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  for (const statement of WORKBOOK_LIBRARY_MIGRATION.statements) database.exec(statement);
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => {
    database.exec("BEGIN");
    try { const result = work(); database.exec("COMMIT"); return result.result; }
    catch (cause) { database.exec("ROLLBACK"); throw cause; }
  } });
  const clock = manualClock(new Date("2026-11-01T00:00:00.000Z")), artifacts = { open: async () => Readable.from([bytes]) };
  const service = createWorkflowWorkbookService({ repository, artifacts, clock });
  return { database, repository, service, clock, artifacts };
}
function saved(result: Awaited<ReturnType<ReturnType<typeof fixture>["service"]["publish"]>>) {
  if (result.state !== "saved") throw new Error("Fixture publication refused");
  return result;
}
it("creates one library workbook per run and recovers a create after the service restarts", async () => {
  const f = fixture();
  const first = saved(await f.service.publish(runId, command(), signal));
  const restarted = createWorkflowWorkbookService({ repository: f.repository, clock: manualClock(new Date("2026-11-02T00:00:00.000Z")), artifacts: { open: async () => { throw new Error("Replay must not read artifacts"); } } });
  expect(await restarted.publish(runId, command(), signal)).toEqual(first);
  const second = saved(await f.service.publish(nextRun, command(), signal));
  expect(second.libraryId).not.toBe(first.libraryId);
  expect(f.repository.list()).toHaveLength(2);
  const workbook = f.repository.read(first.libraryId)?.workbook;
  expect(workbook?.sheets[0].rows[1].cells[1]).toEqual({ value: "000012345", numFmt: "@" });
  expect(JSON.stringify(workbook)).not.toContain("ssn");
});
it("appends once to a linked workbook and preserves earlier rows and unrelated sheets", async () => {
  const f = fixture(), first = saved(await f.service.publish(runId, command(), signal));
  const original = f.repository.read(first.libraryId); expect(original).toBeDefined();
  if (original === undefined) throw new Error("Missing fixture workbook");
  const other = { id: "other", name: "Other", width: 1, hidden: [], rows: [{ id: "note", cells: [{ value: "Preserve me" }] }] };
  const before = f.repository.save({ ...original, version: 2, workbook: { ...original.workbook, sheets: [...original.workbook.sheets, other] } }, 1);
  const appended = WorkflowWorkbookCommandSchema.parse({ ...command(), target: { kind: "append", libraryId: first.libraryId, expectedVersion: 2, sheetId: before.workbook.sheets[0].id } });
  const result = await f.service.publish(nextRun, appended, signal);
  expect(result).toMatchObject({ state: "saved", version: 3 });
  expect(await f.service.publish(nextRun, appended, signal)).toEqual(result);
  const after = f.repository.read(first.libraryId);
  expect(after?.workbook.sheets[0].rows).toHaveLength(3);
  expect(after?.workbook.sheets[0].rows.slice(0, 2)).toEqual(before.workbook.sheets[0].rows);
  expect(after?.workbook.sheets[1]).toEqual(before.workbook.sheets[1]);
  expect(f.repository.history(first.libraryId)).toHaveLength(3);
  await expect(f.service.publish(nextRun, { ...appended, target: { ...appended.target, kind: "replace" } }, signal)).rejects.toThrow();
});
it("refuses stale links and malformed table widths without publishing a version", async () => {
  const f = fixture(), first = saved(await f.service.publish(runId, command(), signal));
  const before = f.repository.read(first.libraryId); if (before === undefined) throw new Error("Missing fixture workbook");
  const target = { kind: "append", libraryId: first.libraryId, expectedVersion: 2, sheetId: before.workbook.sheets[0].id };
  await expect(f.service.publish(nextRun, { ...command(), target }, signal)).rejects.toMatchObject({ code: "WORKBOOK_VERSION_CONFLICT" });
  await expect(f.service.publish(nextRun, { ...command(), source: { kind: "table", table: { ...table, columns: ["wrong"] } } }, signal)).rejects.toThrow();
  expect(f.repository.history(first.libraryId)).toHaveLength(1);
});
it("imports XLSX values, text IDs, styles and dates as new workbooks and new linked versions", async () => {
  const input = new ExcelJS.Workbook(), sheet = input.addWorksheet("Downloaded");
  sheet.addRow(["PPS", "Date"]); sheet.addRow(["000012345", new Date("2026-10-01T00:00:00.000Z")]);
  sheet.getCell("A2").numFmt = "@";
  sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
  const bytes = Buffer.from(await input.xlsx.writeBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact = ArtifactRefSchema.parse({ id: "00000000-0000-4000-8000-000000000003", sha256, bytes: bytes.length, mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const source = { kind: "xlsx", name: "Downloaded.xlsx", artifact };
  const f = fixture(bytes);
  const imported = saved(await f.service.publish(runId, { operationKey: "download", source, target: { kind: "create", name: "Downloaded.xlsx" } }, signal));
  const document = f.repository.read(imported.libraryId)?.workbook;
  expect(document?.sheets[0].rows[1].cells[0]).toMatchObject({ value: "000012345", numFmt: "@", background: "#ff0000" });
  expect(document?.sheets[0].rows[1].cells[1].value).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  const replace = { operationKey: "download", source, target: { kind: "replace", libraryId: imported.libraryId, expectedVersion: 1 } };
  const replacement = await f.service.publish(nextRun, replace, signal);
  expect(replacement).toMatchObject({ state: "saved", libraryId: imported.libraryId, version: 2 });
  expect(await f.service.publish(nextRun, replace, signal)).toEqual(replacement);
  expect(f.repository.history(imported.libraryId)).toHaveLength(2);
  const concurrentRun = "00000000-0000-4000-8000-000000000004";
  const create = { operationKey: "download", source, target: { kind: "create", name: "Concurrent.xlsx" } };
  const attempts = await Promise.all([f.service.publish(concurrentRun, create, signal), f.service.publish(concurrentRun, create, signal)]);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(f.repository.history(saved(attempts[0]).libraryId)).toHaveLength(1);
});
it("does not publish cancelled work and rolls back a failed history publication", async () => {
  const f = fixture();
  await expect(f.service.publish(runId, command(), AbortSignal.abort())).rejects.toThrow();
  expect(f.repository.list()).toHaveLength(0);
  f.database.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON workbook_library_history BEGIN SELECT RAISE(ABORT,'injected'); END");
  await expect(f.service.publish(runId, command(), signal)).rejects.toBeInstanceOf(WorkbookLibraryError);
  expect(f.repository.list()).toHaveLength(0);
});
it("reports malformed XLSX as invalid before any library mutation", async () => {
  const bytes = Buffer.from("Not an XLSX archive"), f = fixture(bytes);
  const artifact = ArtifactRefSchema.parse({ id: "00000000-0000-4000-8000-000000000003", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const input = WorkflowWorkbookCommandSchema.parse({ operationKey: "invalid", source: { kind: "xlsx", name: "Invalid.xlsx", artifact }, target: { kind: "create", name: "Invalid" } });
  const adapter = createWorkbookLibraryAdapter({ ...f, runId });
  const outcome = await adapter.invoke({ capability: "workbooks.library", payload: { schemaHash: deriveSchemaHash(WorkflowWorkbookCommandSchema, "output"), value: input } },
    { signal, requestId: randomUUID(), deadlineMonotonicMs: 60_000 });
  expect(outcome.response).toMatchObject({ state: "produced", value: { value: { state: "refused", code: "WORKBOOK_INVALID" } } });
  expect(f.repository.list()).toHaveLength(0);
});

it("workbooks/publish — publishes through the actual declared-provider client and records complete task provenance", async () => {
  const f = fixture(), { fixtureWorkflow } = createSearchWorkflowDefinitionFixtures();
  const { descriptor } = compileFixtureWorkflow(fixtureWorkflow("workbook-fixture", ({ task, result }) => {
    const publication = task({ id: "publish", contract: ReadWorkbookResult, replay: "always-rerun" }, [], () => command());
    return { steps: [[{ key: "output", label: "Output" }, [publication]]], result: result(ReadWorkbookResult.output, [publication], ({ outputs }) => outputs.publish) };
  }));
  const execution = { runId, traceId: "fx-000000-0001", attempt: 1, workflowId: descriptor.id, nodeId: "publish", taskId: ReadWorkbookResult.id };
  const client = createProviderClient("workbooks.library", { execution: { runId, attempt: 1, nodeId: "publish", taskId: ReadWorkbookResult.id }, configSnapshot: CONFIG_SNAPSHOT,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    runSignal: signal, adapters: { "workbooks.library": createWorkbookLibraryAdapter({ ...f, runId }) }, clock: f.clock,
    idFactory: { next: randomUUID }, deadlineScheduler: { schedule: () => ({ cancel: () => undefined }) },
  });
  const collector = createTaskProvenanceCollector({ descriptor, execution, upstreamEvidence: { checkpoints: [] }, clock: f.clock, onRecord: () => undefined });
  const output = await readWorkbookResultTask.impl.run({ input: command(), ctx: {
    signal, providers: { "workbooks.library": client }, log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code, message): never => { throw new Error(`${code}: ${message}`); }, recordData: collector.recordData,
  } });
  expect(output.state).toBe("saved");
  expect(() => collector.finalizeRead(output)).not.toThrow();
  expect(f.repository.list()).toHaveLength(1);
});
