import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { buildRunWorkbookSection, createRunWorkbookService } from "../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { createWorkbookLibraryAdapter } from "../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createProviderClient } from "../../../src/backend/processing/providers/provider-client.js";
import { readWorkbookResultTask } from "../../../src/backend/processing/workbooks/tasks/read-result.js";
import { ReadWorkbookResult, WorkbookReferenceWriteSchema } from "../../../src/models/processing/workbooks/read-result.js";
import { encodeEditableWorkbook, RunWorkbookReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { RunRecordSchema, type RunRecord } from "../../../src/models/run/record.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { singleAppliedRunId } from "../../support/fixtures/operator-command-fixtures.js";
import { testRunService, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { CONFIG_SNAPSHOT, NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { workbookWriteLogStep } from "../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js";

const input = z.strictObject({ eid: EidSchema });
const patch = WorkbookReferenceWriteSchema.parse({ kind: "patch-reference", writeId: "result", typeId: "synthetic-roster",
  key: "10800000", values: [{ fieldId: "roster.result", value: "complete" }] });
const descriptor = defineWorkflowDescriptor({ id: "workbook-consumer", code: "wc", version: 1, contractFingerprint: "a".repeat(64),
  label: "Workbook consumer", icon: "Search", category: "operations", canonicalInput: defineCanonicalInput(input, input, [{ eid: patch.key }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "allow-parallel", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], requiredWorkbookTypeIds: [patch.typeId], identity: { matchKey: value => value.eid },
  presentation: { title: value => value.eid }, scenarios: ["workbooks/publish"],
  flow: flow(input).step("write-reference", ReadWorkbookResult, { dependsOn: [], replay: "always-rerun", bind: () => patch })
    .build({ schema: ReadWorkbookResult.output, dependsOn: ["write-reference"], derive: ({ outputs }) => outputs["write-reference"] }),
});
const fixtureProfiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(fixtureProfiles.create);
afterAll(() => fixtureProfiles.close());
afterEach(async () => {
  for (const database of world.openDatabases.splice(0)) database.close();
  for (const profile of world.profiles.splice(0)) await profile.close();
  for (const root of world.roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture(duplicate = false) {
  const h = await world.createHarness(undefined, { descriptors: [descriptor] });
  const profile = world.profiles.at(-1); assert.ok(profile);
  const repository = h.database.authority.workbooks;
  const library = createWorkbookLibraryService({ repository, clock: h.clock, sync: unexpectedWorkbookSync });
  const sheet = (id: string, key: string) => ({ id, name: id, width: 4, hidden: [], headerRow: 1,
    columnBindings: ["eid", "roster.result", "roster.date", "roster.flag"].map((fieldId, index) => ({ id: `col-${index}`,
      sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
    rows: [{ id: `${id}-header`, cells: ["EID", "Result", "Date", "Flag"].map(value => ({ value })) },
      { id: `${id}-person`, cells: [{ value: key }, { value: null }, { value: new Date("2026-10-31T01:02:03.000Z") }, { value: false }] }] });
  const saved = library.create({ name: "Synthetic.xlsx", themes: [], hasFormulas: false,
    sheets: [sheet("people", patch.key), sheet("archive", duplicate ? patch.key : "10800001")] });
  repository.putType({ id: patch.typeId, name: "Synthetic roster", keyFieldId: "eid",
    fields: ["eid", "roster.result", "roster.date", "roster.flag"], defaultWorkbookId: null });
  library.operatorOperation(saved.libraryId, "declare-type", { kind: "metadata", expectedVersion: 1,
    metadata: { typeId: patch.typeId, sharePoint: null } });
  const type = repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  repository.putType({ ...type, defaultWorkbookId: saved.libraryId });
  const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
  const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
    descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined }, workbooks: library, planTtlMs: 600_000,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  const selection = { entry: 1, typeId: patch.typeId, keys: [patch.key, "missing"], fields: ["roster.result", "roster.date", "roster.flag"] };
  const request = { workflowId: descriptor.id, submissions: [{ eid: patch.key }], dryRun: false, workbookReferences: [selection] };
  const plan = () => {
    const wire = planner.plan(request), record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record);
    return record;
  };
  const start = (record = plan()) => {
    const result = h.kernel.execute(world.startCommand(record));
    const run = h.database.authority.runs.get(singleAppliedRunId(result)); assert.ok(run); return run;
  };
  const running = (run: RunRecord) => {
    const ports = testWorkerPorts(h.database, h.clock, { path: profile.path, descriptor, poolIndex: 1 });
    const worker = h.database.authority.workerSlots.list(descriptor.id).find(value => value.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("fixture claim refused");
    assert.equal(claimed.run.envelope.runId, run.envelope.runId);
    const service = testRunService(h.database, h.clock);
    const claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
    const validating = service.workerTransition({ commandId: randomUUID(), runId: run.envelope.runId, claim,
      lifecycle: { state: "validating", workerId: worker.workerId, claimedAt: NOW, heartbeatAt: NOW } });
    assert.equal(validating.state, "applied");
    const current = service.workerTransition({ commandId: randomUUID(), runId: run.envelope.runId, claim,
      lifecycle: { state: "running", workerId: worker.workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "write-reference" } });
    if (current.state !== "applied") throw new Error("fixture running transition refused"); return current.run;
  };
  const runs = createRunWorkbookService({ database: h.database, clock: h.clock });
  const section = (run: RunRecord) => h.database.withAuthorityReadSnapshot(() => buildRunWorkbookSection(h.database.authority, run));
  const choice = (run: RunRecord) => {
    const operation = section(run).operations[0]; assert.equal(operation.resolution.state, "available");
    if (operation.resolution.state !== "available") throw new Error("fixture row choice unavailable");
    return { commandId: world.nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "run-detail", family: "run",
      type: "resolve-workbook-row", target: operation.resolution.target, payload: operation.resolution.candidates[0] };
  };
  const edit = (change: (workbook: ReturnType<typeof library.read>["workbook"]) => void) => {
    const current = library.read(saved.libraryId), workbook = structuredClone(current.workbook); change(workbook);
    library.operatorOperation(saved.libraryId, randomUUID(), { kind: "save", expectedVersion: current.version,
      workbook: encodeEditableWorkbook(workbook) });
  };
  return { ...h, repository, library, id: saved.libraryId, planner, selection, request, plan, start, running, runs, section, choice, edit };
}

it("binds exact values, revision and all worksheet identities through real planning and start confirmation", async () => {
  const f = await fixture(), plan = f.plan();
  const bound = plan.planned[0].workbookReferences?.[0]; assert.ok(bound);
  const reference = RunWorkbookReferenceSchema.parse(bound.value);
  expect(reference.snapshot).toMatchObject({ libraryId: f.id, version: 2, worksheets: [{ sheetId: "people", name: "people" }, { sheetId: "archive", name: "archive" }],
    rows: [{ key: patch.key, state: "matched", matches: [{ sheetId: "people", rowId: "people-person",
      values: { "roster.result": null, "roster.date": { type: "date", value: "2026-10-31T01:02:03.000Z" }, "roster.flag": false } }] },
      { key: "missing", state: "missing", matches: [] }] });
  f.edit(workbook => { workbook.sheets[0].name = "Renamed"; workbook.sheets.pop(); });
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  f.repository.putType({ ...type, defaultWorkbookId: null });
  const changedFingerprint = f.kernel.execute({ ...world.startCommand(plan), payload: { ...world.startCommand(plan).payload, inputFingerprint: "b".repeat(64) } });
  expect(changedFingerprint.state).toBe("rejected");
  expect(f.database.authority.runs.listByWorkflow(descriptor.id)).toEqual([]);
  const run = f.start(plan);
  expect(run.input.workbookReferences).toEqual(plan.planned[0].workbookReferences);
  expect(run.input.parsed.value).toEqual({ eid: patch.key });
  const explicit = f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, libraryId: f.id }] });
  const selected = f.database.authority.startPlans.get(explicit.startPlanId); assert.ok(selected);
  const selectedRun = f.start(selected), selectedBound = selectedRun.input.workbookReferences?.[0]; assert.ok(selectedBound);
  expect(RunWorkbookReferenceSchema.parse(selectedBound.value)).toMatchObject({ request: { libraryId: f.id }, snapshot: { libraryId: f.id, version: 3 } });
});

it("requires exactly the declared consumer types and refuses missing, duplicate or foreign planning references", async () => {
  const f = await fixture();
  for (const workbookReferences of [[], [f.selection, f.selection], [{ ...f.selection, typeId: "foreign" }], [{ ...f.selection, libraryId: "absent" }]]) {
    const plan = f.planner.plan({ ...f.request, workbookReferences });
    expect(plan.planned).toEqual([]); expect(plan.refused).toHaveLength(1);
  }
  expect(() => f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, entry: 2 }] })).toThrow();
  expect(f.database.authority.runs.listByWorkflow(descriptor.id)).toEqual([]);
});

it("executes the registered workbook task through its real provider using the captured run reference", async () => {
  const f = await fixture(), run = f.running(f.start()), signal = new AbortController().signal;
  const client = createProviderClient("workbooks.library", { execution: { runId: run.envelope.runId, attempt: 1,
    nodeId: "write-reference", taskId: ReadWorkbookResult.id }, configSnapshot: CONFIG_SNAPSHOT,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    runSignal: signal, adapters: { "workbooks.library": createWorkbookLibraryAdapter({ repository: f.repository, clock: f.clock,
      runId: run.envelope.runId, references: { runId: run.envelope.runId, write: command => f.runs.write(run, command) } }) },
    clock: f.clock, idFactory: { next: randomUUID }, deadlineScheduler: { schedule: () => ({ cancel: () => undefined }) } });
  const output = await readWorkbookResultTask.impl.run({ input: patch, ctx: { signal, providers: { "workbooks.library": client },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code, message): never => { throw new Error(`${code}: ${message}`); }, recordData: () => undefined } });
  expect(output).toMatchObject({ state: "recorded", libraryId: f.id, receiptState: "applied", version: 3 });
  const receipt = f.runs.write(run, patch);
  expect(receipt).toMatchObject({ state: "applied", source: { kind: "run", runId: run.envelope.runId } });
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(1);
  expect(f.section(run).operations).toHaveLength(1);
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBe("complete");
  for (const invalid of [{ ...patch, key: "foreign" }, { ...patch, typeId: "foreign" }, { ...patch, values: [{ fieldId: "undeclared", value: true }] },
    { ...patch, values: [{ fieldId: "roster.result", value: "changed replay" }] }]) expect(() => f.runs.write(run, invalid)).toThrow();
  const corrupt = RunRecordSchema.parse({ ...run, input: { ...run.input, workbookReferences: run.input.workbookReferences?.map(value => ({ ...value, schemaHash: "f".repeat(64) })) } });
  expect(() => f.runs.write(corrupt, patch)).toThrow();
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  f.repository.putType({ ...type, keyFieldId: "roster.result" });
  expect(f.runs.write(run, patch)).toEqual(receipt);
  expect(() => f.runs.write(run, { ...patch, writeId: "next-result" })).toThrow(expect.objectContaining({ code: "WORKBOOK_INVALID" }));
});

it("serves a resolve-required Logs row choice and applies only the retained values through the canonical command", async () => {
  const f = await fixture(true), run = f.running(f.start());
  expect(f.runs.write(run, patch)).toMatchObject({ state: "resolve-required", reason: "duplicate-key", changes: [] });
  const before = f.section(run), command = f.choice(run);
  expect(workbookWriteLogStep(before.operations[0])).toMatchObject({ entries: [{ kind: "decision", decision: { state: "review" } }] });
  // Candidate labels are display data; the command carries identity only.
  const { label: _label, ...payload } = command.payload;
  const request = { ...command, payload };
  const result = f.kernel.execute(request);
  expect(result.state).toBe("applied");
  const after = f.section(run);
  expect(after.operations[0].resolution).toEqual({ state: "resolved" });
  expect(after.operations[1].receipt).toMatchObject({ state: "applied", changes: [{ newValue: "complete" }] });
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBe("complete");
  expect(f.library.read(f.id).workbook.sheets[1].rows[1].cells[1].value).toBeNull();
  expect(f.kernel.execute(request).state).toBe("already-applied");
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(2);
  expect(f.kernel.execute({ ...request, commandId: world.nextCommandId() }).state).toBe("rejected");
  expect(f.kernel.execute({ ...request, commandId: world.nextCommandId(), payload: { ...payload, values: { "roster.result": "forged" } } }).state).toBe("rejected");
});

it.each(["revision", "key", "worksheet", "operator-cell"] as const)("rejects a stale row choice after a live %s change", async change => {
  const f = await fixture(true), run = f.running(f.start()); f.runs.write(run, patch);
  const command = f.choice(run), { label: _label, ...payload } = command.payload;
  f.edit(workbook => {
    if (change === "revision") workbook.name = "Renamed.xlsx";
    if (change === "key") workbook.sheets[0].rows[1].cells[0].value = "10800002";
    if (change === "worksheet") workbook.sheets.shift();
    if (change === "operator-cell") workbook.sheets[0].rows[1].cells[1].value = "operator";
  });
  const before = f.library.read(f.id);
  expect(f.kernel.execute({ ...command, payload }).state).toBe("rejected");
  expect(f.library.read(f.id)).toEqual(before);
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(1);
  if (change === "operator-cell") {
    const fresh = f.choice(run), { label: _freshLabel, ...freshPayload } = fresh.payload;
    expect(f.kernel.execute({ ...fresh, payload: freshPayload }).state).toBe("rejected");
    expect(f.library.read(f.id)).toEqual(before);
  }
});

it("requires a choice after master changes and never offers a worksheet added after the captured snapshot", async () => {
  const f = await fixture(), run = f.running(f.start());
  f.edit(workbook => { const sheet = structuredClone(workbook.sheets[0]); sheet.id = "new-sheet"; sheet.name = "New"; workbook.sheets.push(sheet); });
  expect(f.runs.write(run, patch)).toMatchObject({ state: "resolve-required", reason: "version-conflict" });
  const section = f.section(run), resolution = section.operations[0].resolution;
  assert.equal(resolution.state, "available"); if (resolution.state !== "available") return;
  expect(resolution.candidates.map(value => value.sheetId)).toEqual(["people"]);
  const command = f.choice(run);
  expect(f.kernel.execute({ ...command, payload: { sheetId: "new-sheet", rowId: "people-person" } }).state).toBe("rejected");
  expect(f.kernel.execute({ ...command, commandId: world.nextCommandId(), target: { ...command.target, receiptDigest: "f".repeat(64) },
    payload: { sheetId: "people", rowId: "people-person" } }).state).toBe("rejected");
  const foreign = f.start();
  expect(f.kernel.execute({ ...command, commandId: world.nextCommandId(), target: { ...command.target, runId: foreign.envelope.runId, expectedVersion: foreign.version },
    payload: { sheetId: "people", rowId: "people-person" } }).state).toBe("rejected");
});

it("retains a missing-key receipt and requires an explicit choice when that key later appears", async () => {
  const f = await fixture(), run = f.running(f.start()), missing = { ...patch, key: "missing" };
  const original = f.runs.write(run, missing);
  expect(original).toMatchObject({ state: "resolve-required", reason: "missing-key" });
  expect(f.section(run).operations[0].resolution).toMatchObject({ state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE" });
  f.edit(workbook => { workbook.sheets[1].rows[1].cells[0].value = "missing"; });
  expect(f.runs.write(run, missing)).toEqual(original);
  expect(f.library.read(f.id).workbook.sheets[1].rows[1].cells[1].value).toBeNull();
  const command = f.choice(run), { label: _label, ...payload } = command.payload;
  expect(payload).toEqual({ sheetId: "archive", rowId: "archive-person" });
  expect(f.kernel.execute({ ...command, payload }).state).toBe("applied");
  expect(f.library.read(f.id).workbook.sheets[1].rows[1].cells[1].value).toBe("complete");
});

it("refuses changed type key semantics even when the workbook revision did not advance", async () => {
  const f = await fixture(), run = f.running(f.start());
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  f.repository.putType({ ...type, keyFieldId: "roster.result" });
  expect(f.library.read(f.id).version).toBe(2);
  expect(() => f.runs.write(run, patch)).toThrow(expect.objectContaining({ code: "WORKBOOK_INVALID" }));
  expect(f.repository.runOperations(run.envelope.runId)).toEqual([]);
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBeNull();
});
