import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION } from "../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkflowWorkbookService } from "../../../src/backend/workbooks/workflow-workbook-service.js";
import { WorkbookLibraryError } from "../../../src/backend/workbooks/workbook-library-service.js";
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

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const runId = "00000000-0000-4000-8000-000000000001";
const nextRun = "00000000-0000-4000-8000-000000000002";
const signal = new AbortController().signal;
const table = i9CheckWorkbookTable([i9RetentionRow({ input: i9CheckInput, initial: i9MatchOutcome({ hits: [], confirmed: [i9Candidate], dropped: [] }) }).row]);
const command = (): WorkflowWorkbookCommand => WorkflowWorkbookCommandSchema.parse({ name: "I-9 results", table });
function fixture() {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  for (const statement of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(statement);
  const repository = createWorkbookLibraryRepository({ database, read: work => work(), mutate: work => {
    database.exec("BEGIN");
    try { const result = work(); database.exec("COMMIT"); return result.result; }
    catch (cause) { database.exec("ROLLBACK"); throw cause; }
  } });
  const clock = manualClock(new Date("2026-11-01T00:00:00.000Z"));
  const publicationSource = () => ({ workflowId: 'i9-check', workflowLabel: 'I-9 Check', partitionDay: '2026-10-31' });
  const service = createWorkflowWorkbookService({ repository, clock, publicationSource });
  return { database, repository, service, clock, publicationSource };
}
function saved(result: Awaited<ReturnType<ReturnType<typeof fixture>["service"]["publish"]>>) {
  if (result.state !== "saved") throw new Error("Fixture publication refused");
  return result;
}
it("workbooks/publish — creates one library workbook per run and replays the same publication", async () => {
  const f = fixture(), first = saved(await f.service.publish(runId, command(), signal));
  expect(await f.service.publish(runId, command(), signal)).toEqual(first);
  const concurrent = await Promise.all([f.service.publish(nextRun, command(), signal), f.service.publish(nextRun, command(), signal)]);
  expect(concurrent[0]).toEqual(concurrent[1]);
  expect(saved(concurrent[0]).libraryId).not.toBe(first.libraryId);
  expect(f.repository.list()).toHaveLength(2);
  expect(f.repository.libraryState(first.libraryId).origin).toEqual({ kind: 'workflow', runId, workflowId: 'i9-check',
    workflowLabel: 'I-9 Check', partitionDay: '2026-10-31', rowCount: table.rows.length, rowSubject: 'person' });
  expect(f.repository.history(first.libraryId)).toHaveLength(0);
  const workbook = f.repository.read(first.libraryId)?.workbook;
  expect(workbook?.sheets[0].rows[1].cells[1]).toEqual({ value: "000012345", numFmt: "@" });
  expect(JSON.stringify(workbook)).not.toContain("ssn");
});
it("recovers the original receipt after operator edits without changing the saved workbook", async () => {
  const f = fixture(), first = saved(await f.service.publish(runId, command(), signal));
  const original = f.repository.read(first.libraryId); expect(original).toBeDefined();
  if (original === undefined) throw new Error("Missing fixture workbook");
  const edited = f.repository.save({ ...original, version: 2, workbook: { ...original.workbook, name: "Operator renamed" } }, 1);
  expect(await f.service.publish(runId, command(), signal)).toEqual(first);
  expect(f.repository.read(first.libraryId)).toEqual(edited);
  await expect(f.service.publish(runId, { ...command(), name: "Changed replay" }, signal)).rejects.toMatchObject({ code: "WORKBOOK_VERSION_CONFLICT" });
  expect(f.repository.history(first.libraryId)).toHaveLength(0);
});
it("refuses linked targets, imports and malformed rows before any library mutation", async () => {
  const f = fixture();
  for (const invalid of [
    { ...command(), target: { kind: "append", libraryId: "linked", expectedVersion: 1, sheetId: "sheet" } },
    { ...command(), source: { kind: "xlsx", name: "SharePoint.xlsx", artifact: {} } },
    { ...command(), table: { ...table, columns: ["wrong"] } },
    { ...command(), table: { ...table, rows: [table.rows[0], table.rows[0]] } },
  ]) await expect(f.service.publish(runId, invalid, signal)).rejects.toThrow();
  expect(f.repository.list()).toHaveLength(0);
});
it("does not publish cancelled work and rolls back a failed immutable creation publication", async () => {
  const f = fixture();
  await expect(f.service.publish(runId, command(), AbortSignal.abort())).rejects.toThrow();
  expect(f.repository.list()).toHaveLength(0);
  f.database.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON workbook_creations BEGIN SELECT RAISE(ABORT,'injected'); END");
  await expect(f.service.publish(runId, command(), signal)).rejects.toBeInstanceOf(WorkbookLibraryError);
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
  expect(collector.finalizeRead(output).provenance.every(field => field.source === "live")).toBe(true);
  expect(f.repository.list()).toHaveLength(1);
});
