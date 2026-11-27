import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, it } from "vitest";
import { Hono } from "hono";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { authenticateOnboardingRosterExecution } from "../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { failureStatus } from "../../../src/backend/transports/http/routes/failure-status.js";
import { registerWorkbookRoutes } from "../../../src/backend/transports/http/routes/workbooks.js";
import { RunWorkbookSelectedRowReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { OnboardingCanonicalValueSchema } from "../../../src/models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_FIELDS } from "../../../src/models/workflows/onboarding/roster.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { appliedRunIds } from "../../support/fixtures/operator-command-fixtures.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const profiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(async () => {
  while (world.openDatabases.length) world.openDatabases.pop()!.close();
  while (world.profiles.length) await world.profiles.pop()!.close();
  while (world.roots.length) rmSync(world.roots.pop()!, { recursive: true, force: true });
});
const first = "hire@example.test", second = "second@example.test";

async function fixture(workflow: AnyWorkflowDescriptor = descriptor) {
  const h = await world.createHarness(undefined, { descriptors: [workflow] });
  const repository = h.database.authority.workbooks;
  const library = createWorkbookLibraryService({ repository, clock: h.clock, sync: unexpectedWorkbookSync });
  const sheet = (id: string, rows: readonly (readonly [string, string, string])[]) => ({
    id, name: id, width: ONBOARDING_ROSTER_FIELDS.length, hidden: [], headerRow: 1,
    columnBindings: ONBOARDING_ROSTER_FIELDS.map((fieldId, index) => ({ id: `${id}-${index}`, sourceColumn: index,
      sourceHeader: fieldId, fieldId, basis: "manual" })),
    rows: [{ id: `${id}-header`, cells: ONBOARDING_ROSTER_FIELDS.map(value => ({ value })) },
      ...rows.map(([rowId, email, name]) => ({ id: rowId, cells: [email, `${name} Hire`, null, null, null].map(value => ({ value })) }))],
  });
  const saved = library.create({ name: "Selected roster.xlsx", themes: [], hasFormulas: false,
    sheets: [sheet("people", [["first", first, "First"], ["second", second, "Second"], ["upper", first.toUpperCase(), "Upper"], ["duplicate", first, "Duplicate"]]),
      sheet("archive", [["archived", first, "Archived"]])] });
  repository.putType({ id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null });
  assert.equal(library.operatorOperation(saved.libraryId, "declare", { kind: "metadata", expectedVersion: saved.version,
    metadata: { typeId: "onboarding-roster", sharePoint: null } }).state, "applied");
  const versionId = library.libraryVersion(saved.libraryId).version.id;
  const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
  const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
    descriptors: { resolve: id => id === workflow.id ? workflow : undefined }, planTtlMs: 600_000,
    workbooks: library, configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  const selection = (entry: number, sheetId = "people", rowId = "first") => ({ entry,
    libraryId: saved.libraryId, versionId: library.libraryVersion(saved.libraryId).version.id, sheetId,
    expectedVersion: library.read(saved.libraryId).version, selectedRow: { sheetId, rowId } });
  const submission = (email = first) => ({ email, mode: "rehire", configuredJobEndDate: "06/30/2027" });
  const request = (emails: readonly string[] = [first]) => ({ workflowId: descriptor.id, dryRun: false,
    submissions: emails.map(email => submission(email)), workbookReferences: emails.map((_email, index) => selection(index + 1)) });
  const plan = (value: unknown = request()) => {
    const wire = planner.plan(value), record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record);
    return { wire, record };
  };
  const start = (record: ReturnType<typeof plan>["record"]) => appliedRunIds(h.kernel.execute(world.startCommand(record))).map(id => {
    const run = h.database.authority.runs.get(id); assert.ok(run); return run;
  });
  const apply = (change: unknown) => library.libraryAction(saved.libraryId, { operationId: randomUUID(),
    expectedRevision: repository.libraryState(saved.libraryId).revision, expectedVersion: library.read(saved.libraryId).version, change }, new AbortController().signal);
  return { ...h, library, repository, id: saved.libraryId, versionId, selection, submission, request, plan, start, apply };
}

describe("selected saved Onboarding row start authority", () => {
  it("pins the current named version when a start selection omits its version ID", async () => {
    const f = await fixture();
    const named = await f.apply({ kind: "create-version", name: "Reviewed roster", from: { kind: "version", versionId: f.versionId }, useNow: true });
    const { versionId: _versionId, ...selection } = f.selection(1);
    const { wire, record } = f.plan({ ...f.request(), workbookReferences: [selection] });
    assert.deepEqual(wire.refused, []);
    assert.equal(wire.planned[0]?.workbookReferences?.[0]?.versionId, named.action.operationId);
    assert.equal(wire.planned[0]?.workbookReferences?.[0]?.versionName, "Reviewed roster");
    const duplicate = f.plan({ ...f.request(), workbookReferences: [selection, f.selection(1)] });
    assert.deepEqual(duplicate.wire.refused.map(refusal => refusal.code), ["capability-unavailable"]);
    const run = f.start(record)[0];
    const reference = RunWorkbookSelectedRowReferenceSchema.parse(run.input.workbookReferences?.[0].value);
    assert.equal(reference.request.versionId, named.action.operationId);
    assert.equal(reference.snapshot.versionName, "Reviewed roster");
  });

  it("protects a named version held by a start plan or a queued run and allows deletion after the run finishes", async () => {
    const f = await fixture();
    const { action: { operationId: versionId } } = await f.apply({ kind: "create-version", name: "Pinned roster", from: { kind: "version", versionId: f.versionId }, useNow: true });
    const app: DashboardApp = new Hono();
    app.onError((error, c) => { const { status, body } = failureStatus(error); return c.json(body, status); });
    registerWorkbookRoutes(app, { workbooks: { library: f.library, workflows: [] } });
    const deleteVersion = (entry: ReturnType<typeof f.library.catalog>[number]) => {
      assert.notEqual(entry.state.selectedVersionId, versionId);
      return app.request(`/api/v1/workbooks/${f.id}/library-actions`, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: randomUUID(),
          expectedVersion: entry.version, expectedRevision: entry.state.revision, change: { kind: "delete-version", versionId } }) });
    };
    const assertDeleteRefused = async () => {
      const [entry] = f.library.catalog();
      const response = await deleteVersion(entry);
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { code: string }).code, "WORKBOOK_VERSION_IN_USE");
      assert.deepEqual(f.library.catalog(), [entry]);
    };

    assert.equal(f.plan().wire.planned.length, 1);
    await f.apply({ kind: "use-version", versionId: f.versionId });
    await assertDeleteRefused();

    await f.apply({ kind: "use-version", versionId });
    const [run] = f.start(f.plan().record);
    assert.equal(run.lifecycle.state, "queued");
    await f.apply({ kind: "use-version", versionId: f.versionId });
    f.clock.advanceWall(601_000);
    await assertDeleteRefused();

    assert.equal(f.kernel.execute(world.runCommand("cancel", run.envelope.runId, run.version)).state, "applied");
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "terminal");
    assert.equal((await deleteVersion(f.library.catalog()[0])).status, 200);
    assert.equal((await app.request(`/api/v1/workbooks/${f.id}/versions/${versionId}`)).status, 404);
  });

  it("refuses selected rows without the declared workbook-row input capability", async () => {
    const f = await fixture(compileWorkflow({ ...onboardingWorkflow, surfaces: {} }).descriptor);
    const { record } = f.plan();
    assert.equal(record.planned.length, 0); assert.deepEqual(record.refused.map(row => row.code), ["capability-unavailable"]);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(descriptor.id), []);
  });

  it.each([false, true])("queues two independent runs from one command with mixed acceptance %s", async mixed => {
    const f = await fixture();
    const request = f.request(mixed ? [first, "missing@example.test", second] : [first, second]);
    request.workbookReferences = mixed
      ? [f.selection(1), f.selection(2, "people", "missing"), f.selection(3, "people", "second")]
      : [f.selection(1), f.selection(2, "people", "second")];
    const { record, wire } = f.plan(request);
    assert.deepEqual(record.refused.map(row => row.entry), mixed ? [2] : []);
    assert.deepEqual(wire.planned.map(row => row.workbookReferences?.[0]?.selectedRow), [
      { sheetId: "people", rowId: "first" }, { sheetId: "people", rowId: "second" }]);
    const runs = f.start(record);
    assert.equal(runs.length, 2); assert.notEqual(runs[0].envelope.runId, runs[1].envelope.runId);
    assert.notEqual(runs[0].envelope.itemId, runs[1].envelope.itemId);
    assert.equal(runs[0].sessionId, runs[1].sessionId);
    for (const [index, run] of runs.entries()) {
      assert.equal(run.lifecycle.state, "queued");
      const input = OnboardingCanonicalValueSchema.parse(run.input.parsed.value);
      assert.equal(input.email, [first, second][index]); assert.equal(input.mode, "rehire");
      assert.equal(input.roster.state, "resolved");
      if (input.roster.state !== "resolved") throw new Error("selected row not resolved");
      assert.equal(input.roster.row.references.legalName, ["First Hire", "Second Hire"][index]);
      const reference = RunWorkbookSelectedRowReferenceSchema.parse(run.input.workbookReferences?.[0].value);
      assert.equal(reference.request.versionId, f.versionId);
      assert.deepEqual(reference.request.keys, [input.email]);
      assert.deepEqual(reference.request.fields, ONBOARDING_ROSTER_FIELDS);
      assert.deepEqual(reference.request.selectedRow, wire.planned[index].workbookReferences?.[0]?.selectedRow);
    }
    assert.deepEqual(f.repository.lastUsed(descriptor.id)?.sources, [{ libraryId: f.id, sheetId: "people" }]);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(descriptor.id).map(run => run.envelope.runId).sort(), runs.map(run => run.envelope.runId).sort());
    assert.deepEqual(f.writeCalls, []);
  });

  it("refuses a reviewed batch whose accepted entries use different physical worksheets", async () => {
    const f = await fixture();
    const request = f.request([first, second]);
    request.workbookReferences = [f.selection(1, "archive", "archived"), f.selection(2, "people", "second")];
    const { record } = f.plan(request);
    assert.equal(record.planned.length, 2);
    const command = world.startCommand(record);
    const result = f.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "replan-required");
    assert.equal(f.database.authority.startPlans.get(record.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(descriptor.id), []);
    assert.equal(f.repository.lastUsed(descriptor.id), undefined);
  });

  it("retains ambiguous physical selection in the reference digest and plan fingerprint", async () => {
    const f = await fixture();
    const a = f.plan(), request = f.request(); request.workbookReferences = [f.selection(1, "people", "duplicate")];
    const b = f.plan(request);
    const aRef = RunWorkbookSelectedRowReferenceSchema.parse(a.record.planned[0].workbookReferences?.[0].value);
    const bRef = RunWorkbookSelectedRowReferenceSchema.parse(b.record.planned[0].workbookReferences?.[0].value);
    assert.deepEqual(aRef.snapshot, bRef.snapshot);
    assert.deepEqual(aRef.snapshot.worksheets.map(sheet => sheet.sheetId), ["people"]);
    assert.deepEqual(aRef.request.selectedRow, { sheetId: "people", rowId: "first" });
    assert.deepEqual(bRef.request.selectedRow, { sheetId: "people", rowId: "duplicate" });
    assert.equal(aRef.snapshot.rows[0].state, "ambiguous");
    assert.notEqual(a.record.inputFingerprint, b.record.inputFingerprint);
    const aInput = OnboardingCanonicalValueSchema.parse(a.record.planned[0].input.value);
    const bInput = OnboardingCanonicalValueSchema.parse(b.record.planned[0].input.value);
    assert.ok(aInput.roster.state === "resolved" && bInput.roster.state === "resolved");
    assert.notEqual(aInput.roster.row.binding.referenceDigest, bInput.roster.row.binding.referenceDigest);
    assert.equal(bInput.roster.row.references.legalName, "Duplicate Hire");
    const run = f.start(a.record)[0];
    const forged = RunRecordSchema.parse({ ...run, input: { ...run.input, parsed: { ...run.input.parsed,
      value: { ...aInput, roster: { ...aInput.roster, row: { ...aInput.roster.row,
        binding: { ...aInput.roster.row.binding, rowId: "duplicate" }, references: bInput.roster.row.references } } } } } });
    assert.throws(() => authenticateOnboardingRosterExecution(f.database.authority, forged), { code: "WORKBOOK_STORAGE_CORRUPT" });
  });

  it("refuses invalid membership, unavailable versions and caller roster without queued effects", async () => {
    const f = await fixture();
    const created = await f.apply({ kind: "create-version", name: "Removed", from: { kind: "version", versionId: f.versionId }, useNow: false });
    const removed = created.result.versions.find(version => version.id === created.action.operationId); assert.ok(removed);
    await f.apply({ kind: "delete-version", versionId: removed.id });
    const cases = [
      { ...f.request(), workbookReferences: [f.selection(1, "foreign", "first")] },
      { ...f.request(), workbookReferences: [f.selection(1, "people", "missing")] },
      { ...f.request(), workbookReferences: [f.selection(1, "people", "people-header")] },
      { ...f.request(), workbookReferences: [{ ...f.selection(1), versionId: removed.id }] },
      { ...f.request(), submissions: [{ ...f.submission(), roster: {} }] },
      { ...f.request(), submissions: [{ ...f.submission(), mode: "unknown" }] },
      { ...f.request(), submissions: [{ ...f.submission(), email: second }] },
    ];
    for (const request of cases) {
      const { record } = f.plan(request); assert.equal(record.planned.length, 0); assert.deepEqual(record.refused.map(row => row.entry), [1]);
    }
    const { record } = f.plan({ ...f.request(), workbookReferences: [{ ...f.selection(1), typeId: "general" }] });
    assert.deepEqual(record.planned, []);
    assert.deepEqual(record.refused.map(({ entry, code }) => [entry, code]), [[1, "capability-unavailable"]]);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(descriptor.id), []);
    assert.deepEqual(f.writeCalls, []); assert.deepEqual(f.workerCalls, []);
  });

  it("refuses invalid typed names from the selected saved version", async () => {
    const f = await fixture(), current = f.library.read(f.id), workbook = structuredClone(current.workbook);
    workbook.sheets[0].rows[1].cells[1].value = null;
    f.library.save(f.id, current.version, workbook);
    const versionId = f.library.libraryVersion(f.id).version.id;
    const { record } = f.plan({ ...f.request(), workbookReferences: [{ ...f.selection(1), versionId }] });
    assert.equal(record.planned.length, 0); assert.deepEqual(record.refused.map(row => row.code), ["input-invalid"]);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(descriptor.id), []);
  });

  it("refuses normalized duplicate identities and active runs without dropping selected entries", async () => {
    const f = await fixture(), request = f.request([first, first.toUpperCase()]);
    request.workbookReferences = [f.selection(1), f.selection(2, "people", "upper")];
    const { record } = f.plan(request);
    assert.equal(record.planned.length, 1);
    assert.deepEqual(record.refused.map(row => [row.entry, row.code]), [[2, "active-run-exists"]]);
    assert.equal(f.start(record).length, 1);
    const active = f.plan(); assert.equal(active.record.planned.length, 0);
    assert.deepEqual(active.record.refused.map(row => row.code), ["active-run-exists"]);
  });

  it("refuses stale writable confirmation and admits a fresh selection of the edited current version", async () => {
    const f = await fixture(), { record } = f.plan();
    const current = f.library.read(f.id), workbook = structuredClone(current.workbook);
    workbook.sheets[0].rows[1].cells[1].value = "Edited master";
    f.library.save(f.id, current.version, workbook);
    const refused = f.kernel.execute(world.startCommand(record));
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "replan-required");
    assert.equal(f.database.authority.startPlans.get(record.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(descriptor.id), []);
    assert.equal(f.repository.lastUsed(descriptor.id), undefined);
    assert.deepEqual(f.writeCalls, []); assert.deepEqual(f.workerCalls, []);
    const fresh = f.plan(), run = f.start(fresh.record)[0];
    assert.deepEqual(run.input.parsed, fresh.record.planned[0].input);
    const input = OnboardingCanonicalValueSchema.parse(run.input.parsed.value);
    assert.ok(input.roster.state === "resolved");
    assert.equal(input.roster.row.references.legalName, "Edited master");
    const reference = RunWorkbookSelectedRowReferenceSchema.parse(run.input.workbookReferences?.[0].value);
    assert.equal(reference.request.versionId, f.library.libraryVersion(f.id).version.id);
    assert.notEqual(reference.request.versionId, f.versionId);
  });
});
