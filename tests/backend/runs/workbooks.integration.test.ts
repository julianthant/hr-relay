import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { buildRunWorkbookSection, createRunWorkbookService } from "../../../src/backend/runs/workbooks.js";
import { WorkbookLibraryError } from "../../../src/backend/workbooks/workbook-library-error.js";
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
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";

const input = z.strictObject({ eid: EidSchema });
const patch = { kind: "patch-reference" as const, writeId: "result", typeId: "synthetic-roster",
  key: "10800000", values: [{ fieldId: "roster.notes", value: "complete" }] };
function buildDescriptor(full = false) { return defineWorkflowDescriptor({ id: "workbook-consumer", code: "wc", version: 1, contractFingerprint: "a".repeat(64),
  label: "Workbook consumer", icon: "Search", category: "operations", canonicalInput: defineCanonicalInput(input, input, [{ eid: patch.key }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "allow-parallel", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], requiredWorkbookFields: ['eid', 'roster.notes', 'roster.backgroundEntered', 'roster.hired'],
  workbookReference: { id: patch.typeId, keyFieldId: 'eid', mode: full ? 'all' : 'keys', writableFields: ['roster.notes'] },
  ...(full ? {} : { referenceKeys: (value: { eid: string }) => [value.eid, 'missing'] }), identity: { matchKey: value => value.eid },
  plannedOutputs: (_value, references) => [{ kind: 'workbook', name: 'Reference report.xlsx', rowSubject: 'record',
    rows: { state: 'known', count: references.flatMap(reference => reference.snapshot.rows.flatMap(row => row.matches)).length } }],
  presentation: { title: value => value.eid }, scenarios: ["workbooks/publish"],
  flow: flow(input).step("write-reference", ReadWorkbookResult, { dependsOn: [], replay: "always-rerun",
    bind: () => ({ ...patch, referenceDigest: "a".repeat(64) }) })
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
    columnBindings: ["eid", "roster.notes", "roster.backgroundEntered", "roster.hired"].map((fieldId, index) => ({ id: `col-${index}`,
      sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
    rows: [{ id: `${id}-header`, cells: ["EID", "Result", "Date", "Flag"].map(value => ({ value })) },
      { id: `${id}-person`, cells: [{ value: key }, { value: null }, { value: new Date("2026-10-31T01:02:03.000Z") }, { value: false }] },
      ...(duplicate && id === "people" ? [{ id: "people-duplicate", cells: [{ value: key }, { value: null }, { value: null }, { value: false }] }] : [])] });
  const saved = library.create({ name: "Synthetic.xlsx", themes: [], hasFormulas: false,
    sheets: [sheet("people", patch.key), sheet("archive", "10800001")] });
  repository.putType({ id: patch.typeId, name: "Synthetic roster", keyFieldId: "eid",
    fields: ["eid", "roster.notes", "roster.backgroundEntered", "roster.hired"], defaultWorkbookId: null });
  library.operatorOperation(saved.libraryId, "declare-type", { kind: "metadata", expectedVersion: 1,
    metadata: { typeId: patch.typeId, sharePoint: null } });
  const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
  const makePlanner = (workbooks: Parameters<typeof createStartPlanService>[0]["workbooks"] = library) => createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
    descriptors: { resolve: id => id === descriptor.id ? selectedDescriptor : undefined }, workbooks, planTtlMs: 600_000,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  const planner = makePlanner();
  const selection = { entry: 1, libraryId: saved.libraryId, versionId: "original", sheetId: "people", expectedVersion: 2 };
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
  const runService = createRunWorkbookService({ database: h.database, clock: h.clock,
    resolveDescriptor: id => id === selectedDescriptor.id ? selectedDescriptor : undefined });
  const runReferenceDigest = (run: RunRecord) => {
    const bound = run.input.workbookReferences?.[0]; assert.ok(bound);
    return sha256Hex(canonicalJsonStringify(bound));
  };
  const runs = { ...runService, write(run: RunRecord, value: unknown) {
    const source = z.record(z.string(), z.unknown()).parse(value);
    return runService.write(run, WorkbookReferenceWriteSchema.parse({ ...source,
      referenceDigest: source.referenceDigest ?? runReferenceDigest(run) }));
  } };
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
  return { ...h, repository, library, id: saved.libraryId, planner, makePlanner, selection, request, plan, start, running,
    runs, runReferenceDigest, section, choice, edit };
}

it("binds the exact selected worksheet and revision through real planning and start confirmation", async () => {
  const f = await fixture(), plan = f.plan();
  const bound = plan.planned[0].workbookReferences?.[0]; assert.ok(bound);
  const reference = parseRunWorkbookReference(bound);
  expect(reference.snapshot).toMatchObject({ versionId: "original", versionName: "Original version", libraryId: f.id, version: 2, worksheets: [{ sheetId: "people", name: "people" }],
    rows: [{ key: patch.key, state: "matched", matches: [{ sheetId: "people", rowId: "people-person",
      values: { "roster.notes": null, "roster.backgroundEntered": { type: "date", value: "2026-10-31T01:02:03.000Z" }, "roster.hired": false } }] },
      { key: "missing", state: "missing", matches: [] }] });
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  f.repository.putType({ ...type, defaultWorkbookId: null });
  const changedFingerprint = f.kernel.execute({ ...world.startCommand(plan), payload: { ...world.startCommand(plan).payload, inputFingerprint: "b".repeat(64) } });
  expect(changedFingerprint.state).toBe("rejected");
  expect(f.database.authority.runs.listByWorkflow(descriptor.id)).toEqual([]);
  const run = f.start(plan);
  expect(run.input.workbookReferences).toEqual(plan.planned[0].workbookReferences);
  expect(run.input.parsed.value).toEqual({ eid: patch.key });
  f.edit(workbook => { workbook.sheets[0].name = "Renamed"; workbook.sheets.pop(); });
  expect(f.planner.plan(f.request).planned).toEqual([]);
  const explicit = f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, versionId: "revision:3", expectedVersion: 3 }] });
  const selected = f.database.authority.startPlans.get(explicit.startPlanId); assert.ok(selected);
  const selectedRun = f.start(selected), selectedBound = selectedRun.input.workbookReferences?.[0]; assert.ok(selectedBound);
  expect(parseRunWorkbookReference(selectedBound)).toMatchObject({ request: { libraryId: f.id }, snapshot: { libraryId: f.id, version: 3 } });
});

it("records a source only for a nonempty confirmed Start and keeps the latest accepted command on replay", async () => {
  const f = await fixture();
  const first = f.plan();
  expect(f.repository.lastUsed(descriptor.id)).toBeUndefined();
  const refused = f.planner.plan({ ...f.request, workbookReferences: [] });
  expect(refused.planned).toEqual([]);
  const emptyPlan = f.database.authority.startPlans.get(refused.startPlanId); assert.ok(emptyPlan);
  expect(f.kernel.execute(world.startCommand(emptyPlan)).state).toBe("applied");
  expect(f.repository.lastUsed(descriptor.id)).toBeUndefined();
  const firstCommand = world.startCommand(first);
  expect(f.kernel.execute(firstCommand).state).toBe("applied");
  expect(f.repository.lastUsed(descriptor.id)).toMatchObject({
    revision: 1, acceptedCommandId: firstCommand.commandId, sources: [{ libraryId: f.id, sheetId: "people" }],
  });
  const rejectedPlan = f.plan();
  const rejectedCommand = world.startCommand(rejectedPlan);
  const rejected = f.kernel.execute({ ...rejectedCommand, payload: { ...rejectedCommand.payload,
    inputFingerprint: "b".repeat(64) } });
  expect(rejected.state).toBe("rejected");
  expect(f.repository.lastUsed(descriptor.id)?.acceptedCommandId).toBe(firstCommand.commandId);
  const second = f.plan();
  const secondCommand = world.startCommand(second);
  expect(f.kernel.execute(secondCommand).state).toBe("applied");
  const latest = f.repository.lastUsed(descriptor.id);
  expect(latest).toMatchObject({ revision: 2, acceptedCommandId: secondCommand.commandId });
  expect(f.kernel.execute(firstCommand).state).toBe("already-applied");
  expect(f.repository.lastUsed(descriptor.id)).toEqual(latest);
});

it("rolls back a confirmed Start when the real preference insert fails", async () => {
  const f = await fixture(), plan = f.plan(), command = world.startCommand(plan);
  const profile = world.profiles.at(-1); assert.ok(profile);
  using raw = new DatabaseSync(profile.path);
  raw.exec("CREATE TRIGGER reject_start_selection BEFORE INSERT ON workflow_workbook_selections BEGIN SELECT RAISE(ABORT, 'injected preference failure'); END");
  const generation = f.database.getMeta().authorityGeneration;
  assert.throws(() => f.kernel.execute(command), error => error instanceof WorkbookLibraryError
    && error.code === "WORKBOOK_STORAGE_FAILED" && error.cause instanceof Error
    && error.cause.message === "injected preference failure");
  expect(f.repository.lastUsed(descriptor.id)).toBeUndefined();
  expect(f.database.authority.startPlans.get(plan.startPlanId)?.consumedBy).toBeUndefined();
  expect(f.database.authority.runs.listByWorkflow(descriptor.id)).toEqual([]);
  expect(f.database.authority.runSessions.listByWorkflow(descriptor.id)).toEqual([]);
  expect(f.database.authority.commands.get(command.commandId)).toBeUndefined();
  expect(f.database.authority.commandAudits.findByCommand(command.commandId)).toBeUndefined();
  expect(f.database.getMeta().authorityGeneration).toBe(generation);
});

it("requires exactly one valid explicit source selection", async () => {
  const f = await fixture();
  for (const workbookReferences of [[], [f.selection, f.selection], [{ ...f.selection, libraryId: "absent" }]]) {
    const plan = f.planner.plan({ ...f.request, workbookReferences });
    expect(plan.planned).toEqual([]); expect(plan.refused).toHaveLength(1);
  }
  expect(() => f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, entry: 2 }] })).toThrow();
  expect(f.database.authority.runs.listByWorkflow(descriptor.id)).toEqual([]);
});

it("rechecks the selected named worksheet on each plan without consulting type defaults", async () => {
  const f = await fixture();
  expect(f.plan().planned).toHaveLength(1);
  const type = f.repository.types().find(type => type.id === patch.typeId); assert.ok(type);
  f.repository.putType({ ...type, defaultWorkbookId: null });
  expect(f.plan().planned).toHaveLength(1);
  const foreign = f.library.create({ name: "Other.xlsx", themes: [], hasFormulas: false,
    sheets: [{ id: "other", name: "Other", width: 1, hidden: [], rows: [{ id: "header", cells: [{ value: "Name" }] }] }] });
  const mismatched = f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection, libraryId: foreign.libraryId }] });
  expect(mismatched.planned).toEqual([]);
  expect(mismatched.refused).toMatchObject([{ code: "capability-unavailable" }]);
  const alteredLibrary = { ...f.library, types: () => f.library.types().map(current => current.id === patch.typeId
    ? { ...current, defaultWorkbookId: foreign.libraryId } : current) };
  const badDefaultPlanner = f.makePlanner(alteredLibrary);
  const badDefault = badDefaultPlanner.plan(f.request);
  expect(badDefault.planned).toHaveLength(1);
  expect(badDefault.refused).toEqual([]);
});

it("executes the registered workbook task through its real provider using the captured run reference", async () => {
  const f = await fixture(), run = f.running(f.start()), signal = new AbortController().signal;
  const client = createProviderClient("workbooks.library", { execution: { runId: run.envelope.runId, attempt: 1,
    nodeId: "write-reference", taskId: ReadWorkbookResult.id }, configSnapshot: CONFIG_SNAPSHOT,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    runSignal: signal, adapters: { "workbooks.library": createWorkbookLibraryAdapter({ repository: f.repository, clock: f.clock,
      runId: run.envelope.runId, references: { runId: run.envelope.runId, write: command => f.runs.write(run, command) } }) },
    clock: f.clock, idFactory: { next: randomUUID }, deadlineScheduler: { schedule: () => ({ cancel: () => undefined }) } });
  const command = WorkbookReferenceWriteSchema.parse({ ...patch,
    referenceDigest: f.runReferenceDigest(run) });
  const output = await readWorkbookResultTask.impl.run({ input: command, ctx: { signal, providers: { "workbooks.library": client },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code, message): never => { throw new Error(`${code}: ${message}`); }, recordData: () => undefined } });
  expect(output).toMatchObject({ state: "recorded", libraryId: f.id, receiptState: "applied", version: 3 });
  const receipt = f.runs.write(run, command);
  expect(receipt).toMatchObject({ state: "applied", source: { kind: "run-reference", runId: run.envelope.runId,
    referenceDigest: command.referenceDigest, authority: { keyFieldId: "eid", writableFields: ["roster.notes"] } } });
  expect(f.repository.runOperations(run.envelope.runId)).toHaveLength(1);
  expect(f.section(run).operations).toHaveLength(1);
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBe("complete");
  for (const invalid of [{ ...patch, key: "foreign" }, { ...patch, typeId: "foreign" }, { ...patch, values: [{ fieldId: "undeclared", value: true }] },
    { ...patch, values: [{ fieldId: "roster.notes", value: "changed replay" }] }]) expect(() => f.runs.write(run, invalid)).toThrow();
  const corrupt = RunRecordSchema.parse({ ...run, input: { ...run.input, workbookReferences: run.input.workbookReferences?.map(value => ({ ...value, schemaHash: "f".repeat(64) })) } });
  expect(() => f.runs.write(corrupt, patch)).toThrow();
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  expect(() => f.repository.putType({ ...type, keyFieldId: "roster.notes" })).toThrow(expect.objectContaining({ code: "WORKBOOK_TYPE_IN_USE" }));
  expect(f.repository.types().find(value => value.id === patch.typeId)).toEqual(type);
  expect(f.runs.write(run, command)).toEqual(receipt);
  const beforeNext = f.library.read(f.id);
  expect(() => f.runs.write(run, { ...patch, writeId: "next-result" })).toThrow(expect.objectContaining({ code: "WORKBOOK_VERSION_CONFLICT" }));
  expect(f.library.read(f.id)).toEqual(beforeNext);
});

it("refuses an ambiguous reference without an authenticated row choice", async () => {
  const f = await fixture(true), run = f.running(f.start()), before = f.library.read(f.id);
  expect(() => f.runs.write(run, patch)).toThrow(expect.objectContaining({ code: "WORKBOOK_INVALID" }));
  expect(f.repository.runOperations(run.envelope.runId)).toEqual([]);
  expect(f.library.read(f.id)).toEqual(before);
});

it("applies an explicitly retained selected row even when another row has the same key", async () => {
  const f = await fixture(true);
  const wire = f.planner.plan({ ...f.request, workbookReferences: [{ ...f.selection,
    selectedRow: { sheetId: "people", rowId: "people-person" } }] });
  const plan = f.database.authority.startPlans.get(wire.startPlanId); assert.ok(plan);
  const run = f.running(f.start(plan));
  expect(f.runs.write(run, patch)).toMatchObject({ state: "applied", source: { kind: "run-reference",
    authority: { sheetId: "people", keyFieldId: "eid", writableFields: ["roster.notes"] } } });
  expect(f.library.read(f.id).workbook.sheets[0].rows[1].cells[1].value).toBe("complete");
  expect(f.library.read(f.id).workbook.sheets[0].rows[2].cells[1].value).toBeNull();
});

it.each(["revision", "key", "worksheet", "operator-cell"] as const)("refuses a new captured write after a live %s change", async change => {
  const f = await fixture(), run = f.running(f.start());
  f.edit(workbook => {
    if (change === "revision") workbook.name = "Renamed.xlsx";
    if (change === "key") workbook.sheets[0].rows[1].cells[0].value = "10800002";
    if (change === "worksheet") workbook.sheets.shift();
    if (change === "operator-cell") workbook.sheets[0].rows[1].cells[1].value = "operator";
  });
  const before = f.library.read(f.id);
  expect(() => f.runs.write(run, patch)).toThrow(expect.objectContaining({ code: "WORKBOOK_VERSION_CONFLICT" }));
  expect(f.library.read(f.id)).toEqual(before);
  expect(f.repository.runOperations(run.envelope.runId)).toEqual([]);
});

it("refuses a missing key without a captured or gate-selected row", async () => {
  const f = await fixture(), run = f.running(f.start()), before = f.library.read(f.id);
  expect(() => f.runs.write(run, { ...patch, key: "missing" })).toThrow(expect.objectContaining({ code: "WORKBOOK_INVALID" }));
  expect(f.repository.runOperations(run.envelope.runId)).toEqual([]);
  expect(f.library.read(f.id)).toEqual(before);
});

it("refuses a declared type key change and preserves its captured reference", async () => {
  const f = await fixture(), run = f.running(f.start());
  const type = f.repository.types().find(value => value.id === patch.typeId); assert.ok(type);
  expect(() => f.repository.putType({ ...type, keyFieldId: "roster.notes" })).toThrow(expect.objectContaining({ code: "WORKBOOK_TYPE_IN_USE" }));
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


it("loads each selected source once in each planning and confirmation scope across entries", async () => {
  const f = await fixture(), read = vi.spyOn(f.repository, "libraryVersion");
  const wire = f.planner.plan({ ...f.request, submissions: [{ eid: patch.key }, { eid: "10800002" }],
    workbookReferences: [f.selection, { ...f.selection, entry: 2 }] });
  const record = f.database.authority.startPlans.get(wire.startPlanId); assert.ok(record);
  expect(record.planned).toHaveLength(2);
  expect(read).toHaveBeenCalledTimes(1);
  const result = f.kernel.execute(world.startCommand(record));
  expect(result.state).toBe("applied");
  expect(read).toHaveBeenCalledTimes(2);
  f.plan();
  expect(read).toHaveBeenCalledTimes(3);
});
