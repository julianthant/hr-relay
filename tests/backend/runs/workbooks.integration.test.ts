import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { buildRunWorkbookSection, createRunWorkbookService } from "../../../src/backend/runs/workbooks.js";
import { decisionAnswerer } from "../../../src/backend/runs/decisions/decision-answer.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { createWorkbookLibraryAdapter } from "../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createProviderClient } from "../../../src/backend/processing/providers/provider-client.js";
import { readWorkbookResultTask } from "../../../src/backend/processing/workbooks/tasks/read-result.js";
import { ReadWorkbookResult, WorkbookReferenceWriteSchema } from "../../../src/models/processing/workbooks/read-result.js";
import { encodeEditableWorkbook, parseRunWorkbookReference } from "../../../src/models/dashboard/workbooks.js";
import { StartPlanRecordSchema } from "../../../src/models/run/start-plan.js";
import { runClaim, RunRecordSchema, type RunRecord } from "../../../src/models/run/record.js";
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
function buildDescriptor(full = false) { return defineWorkflowDescriptor({ id: "workbook-consumer", code: "wc", version: 1, contractFingerprint: "a".repeat(64),
  label: "Workbook consumer", icon: "Search", category: "operations", canonicalInput: defineCanonicalInput(input, input, [{ eid: patch.key }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "allow-parallel", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], requiredWorkbookTypeIds: [patch.typeId],
  referenceLookups: value => [full ? { mode: 'all', typeId: patch.typeId, fields: ['roster.result', 'roster.date', 'roster.flag'] } : { typeId: patch.typeId, keys: [value.eid, 'missing'], fields: ['roster.result', 'roster.date', 'roster.flag'] }], identity: { matchKey: value => value.eid },
  plannedOutputs: (_value, references) => [{ kind: 'workbook', name: 'Reference report.xlsx', rowSubject: 'record',
    rows: { state: 'known', count: references.flatMap(reference => reference.snapshot.rows.flatMap(row => row.matches)).length } }],
  presentation: { title: value => value.eid }, scenarios: ["workbooks/publish"],
  flow: flow(input).step("write-reference", ReadWorkbookResult, { dependsOn: [], replay: "always-rerun", bind: () => patch })
    .build({ schema: ReadWorkbookResult.output, dependsOn: ["write-reference"], derive: ({ outputs }) => outputs["write-reference"] }),
}); }
const descriptor = buildDescriptor();
const fixtureProfiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(fixtureProfiles.create);
const releaseClaims: (() => void)[] = [];
afterAll(() => fixtureProfiles.close());
afterEach(async () => {
  while (releaseClaims.length > 0) {
    const release = releaseClaims.at(-1); assert.ok(release);
    release(); releaseClaims.pop();
  }
  while (world.openDatabases.length > 0) {
    const database = world.openDatabases.at(-1); assert.ok(database);
    database.close(); world.openDatabases.pop();
  }
  while (world.profiles.length > 0) {
    const profile = world.profiles.at(-1); assert.ok(profile);
    await profile.close(); world.profiles.pop();
  }
  while (world.roots.length > 0) {
    const root = world.roots.at(-1); assert.ok(root);
    rmSync(root, { recursive: true, force: true }); world.roots.pop();
  }
});

async function fixture(duplicate = false, full = false) {
  const selectedDescriptor = full ? buildDescriptor(true) : descriptor;
  const h = await world.createHarness(undefined, { descriptors: [selectedDescriptor] });
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
    descriptors: { resolve: id => id === descriptor.id ? selectedDescriptor : undefined }, workbooks: library, planTtlMs: 600_000,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  const selection = { entry: 1, typeId: patch.typeId };
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
    const ports = testWorkerPorts(h.database, h.clock, { path: profile.path, descriptor: selectedDescriptor, poolIndex: 1 });
    const worker = h.database.authority.workerSlots.list(descriptor.id).find(value => value.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("fixture claim refused");
    assert.equal(claimed.run.envelope.runId, run.envelope.runId);
    const service = testRunService(h.database, h.clock);
    const claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
    releaseClaims.push(() => {
      const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current);
      const owner = runClaim(current); assert.ok(owner);
      assert.equal(owner.workerId, claim.workerId); assert.equal(owner.claimGeneration, claim.claimGeneration);
      assert.deepEqual(h.database.authority.writeIntents.listByRun(current.envelope.runId), []);
      assert.throws(() => h.database.assertWorkerLifecycleRelease(worker.workerId), /worker-lifecycle-release-unproved/u);
      assert.equal(service.requeue({ commandId: randomUUID(), runId: current.envelope.runId,
        expectedVersion: current.version, claim, cause: "recovery" }).state, "applied");
      const released = h.database.authority.runs.get(current.envelope.runId); assert.ok(released);
      assert.equal(runClaim(released), undefined); assert.equal(released.lifecycle.state, "queued");
      h.database.assertWorkerLifecycleRelease(worker.workerId);
    });
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
    const candidate = operation.resolution.candidates[0]; assert.ok(candidate);
    return { commandId: world.nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "run-detail", family: "run",
      type: "resolve-workbook-row", target: operation.resolution.target, payload: { sheetId: candidate.sheetId, rowId: candidate.rowId } };
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
  const reference = parseRunWorkbookReference(bound);
  expect(reference.snapshot).toMatchObject({ versionId: "original", versionName: "Original version", libraryId: f.id, version: 2, worksheets: [{ sheetId: "people", name: "people" }, { sheetId: "archive", name: "archive" }],
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
  expect(parseRunWorkbookReference(selectedBound)).toMatchObject({ request: { libraryId: f.id }, snapshot: { libraryId: f.id, version: 3 } });
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
  expect(() => f.repository.putType({ ...type, keyFieldId: "roster.result" })).toThrow(expect.objectContaining({ code: "WORKBOOK_TYPE_IN_USE" }));
  expect(f.repository.types().find(value => value.id === patch.typeId)).toEqual(type);
  expect(f.runs.write(run, patch)).toEqual(receipt);
  const beforeNext = f.library.read(f.id);
  expect(f.runs.write(run, { ...patch, writeId: "next-result" })).toMatchObject({ state: "resolve-required", reason: "version-conflict", changes: [] });
  expect(f.library.read(f.id)).toEqual(beforeNext);
});

it("serves a resolve-required Logs row choice and applies only the retained values through the canonical command", async () => {
  const f = await fixture(true), run = f.running(f.start());
  expect(f.runs.write(run, patch)).toMatchObject({ state: "resolve-required", reason: "duplicate-key", changes: [] });
  const before = f.section(run), request = f.choice(run);
  expect(workbookWriteLogStep(before.operations[0])).toMatchObject({ entries: [{ kind: "decision", decision: { state: "review" } }] });
  const result = f.kernel.execute(request);
  expect(result.state).toBe("applied");
  const after = f.section(run);
  expect(after.operations[0].resolution).toEqual({ state: "resolved" });
  const answered = f.database.withAuthorityReadSnapshot(() => buildRunWorkbookSection(f.database.authority, run,
    decisionAnswerer(f.database.authority.commands, () => "Fixture Operator")));
  expect(answered.operations[0].resolution).toEqual({ state: "resolved", answer: { optionId: "confirm", label: "Confirm row", at: NOW,
    actor: { kind: "person", name: "Fixture Operator" } } });
  expect(after.operations[1].receipt).toMatchObject({ state: "applied", changes: [{ newValue: "complete" }] });
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBe("complete");
  expect(f.library.read(f.id).workbook.sheets[1].rows[1].cells[1].value).toBeNull();
  expect(f.kernel.execute(request).state).toBe("already-applied");
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(2);
  expect(f.kernel.execute({ ...request, commandId: world.nextCommandId() }).state).toBe("rejected");
  const forged = { ...request, commandId: world.nextCommandId(), payload: { ...request.payload, values: { "roster.result": "forged" } } };
  const generation = f.database.getMeta().authorityGeneration, workbook = f.library.read(f.id);
  expect(() => f.kernel.execute(forged)).toThrow(z.ZodError);
  expect(f.database.authority.commands.get(forged.commandId)).toBeUndefined();
  expect(f.database.getMeta().authorityGeneration).toBe(generation);
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(2);
  expect(f.library.read(f.id)).toEqual(workbook);
});

it.each(["revision", "key", "worksheet", "operator-cell"] as const)("rejects a stale row choice after a live %s change", async change => {
  const f = await fixture(true), run = f.running(f.start()); f.runs.write(run, patch);
  const command = f.choice(run);
  f.edit(workbook => {
    if (change === "revision") workbook.name = "Renamed.xlsx";
    if (change === "key") workbook.sheets[0].rows[1].cells[0].value = "10800002";
    if (change === "worksheet") workbook.sheets.shift();
    if (change === "operator-cell") workbook.sheets[0].rows[1].cells[1].value = "operator";
  });
  const before = f.library.read(f.id);
  expect(f.kernel.execute(command).state).toBe("rejected");
  expect(f.library.read(f.id)).toEqual(before);
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(1);
  if (change === "operator-cell") {
    expect(f.kernel.execute(f.choice(run)).state).toBe("rejected");
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
  const pick = resolution.decision?.options[0];
  expect([resolution.decision?.type, pick?.send]).toEqual(["workbook-row", { via: "action", actionKey: "resolve-workbook-row" }]);
  const table = pick?.input?.kind === "candidate" ? pick.input.table : undefined;
  expect(table?.rows.map(({ sheetId, rowId }) => ({ sheetId, rowId }))).toEqual(resolution.candidates.map(({ sheetId, rowId }) => ({ sheetId, rowId })));
  expect(table?.rows.every(({ rowNumber }) => rowNumber !== undefined && rowNumber > 0)).toBe(true);
  expect(table?.typed?.pattern).toBe("^[1-9]\\d*$");
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
  const command = f.choice(run);
  expect(command.payload).toEqual({ sheetId: "archive", rowId: "archive-person" });
  expect(f.kernel.execute(command).state).toBe("applied");
  expect(f.library.read(f.id).workbook.sheets[1].rows[1].cells[1].value).toBe("complete");
});

it("refuses a declared type key change and preserves its captured reference", async () => {
  const f = await fixture(), run = f.running(f.start());
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  expect(() => f.repository.putType({ ...type, keyFieldId: "roster.result" })).toThrow(expect.objectContaining({ code: "WORKBOOK_TYPE_IN_USE" }));
  expect(f.repository.types().find(value => value.id === patch.typeId)).toEqual(type);
  expect(f.library.read(f.id).version).toBe(2);
  expect(f.repository.runOperations(run.envelope.runId)).toEqual([]);
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBeNull();
  expect(f.runs.write(run, patch)).toMatchObject({ state: "applied", version: 3 });
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBe("complete");
});

it.each([false, true])("full roster snapshots grant no keyed workbook write authority; explicit named=%s", async named => {
  const f = await fixture(false, true);
  const wire = f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, ...(named ? { versionId: "original" } : {}) }] });
  const plan = f.database.authority.startPlans.get(wire.startPlanId); assert.ok(plan);
  const run = f.running(f.start(plan));
  const before = f.library.read(f.id);
  expect(() => f.runs.write(run, patch)).toThrow(expect.objectContaining({ code: "WORKBOOK_INVALID" }));
  expect(f.repository.runOperations(run.envelope.runId)).toEqual([]);
  expect(f.library.read(f.id)).toEqual(before);
});

it('refuses caller-authored lookup keys and fields instead of treating them as workflow authority', async () => {
  const f = await fixture();
  expect(() => f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, keys: ['different'], fields: ['eid'] }] })).toThrow();
});

it('projects workflow-authored output facts and binds them into the retained plan fingerprint', async () => {
  const f = await fixture(), wire = f.planner.plan(f.request);
  expect(wire.planned[0].outputs).toEqual([{ kind: 'workbook', name: 'Reference report.xlsx', rowSubject: 'record', rows: { state: 'known', count: 1 } }]);
  const plan = f.plan();
  expect(() => StartPlanRecordSchema.parse({ ...plan, planned: plan.planned.map(run => ({ ...run, outputs: [{ kind: 'workbook', name: 'Different.xlsx', rowSubject: 'record', rows: { state: 'known', count: 99 } }] })) })).toThrow();

});
