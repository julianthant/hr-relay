import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, it } from "vitest";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { authenticateOnboardingRosterChoice, buildRunWorkbookSection } from "../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { encodeEditableWorkbook } from "../../../src/models/dashboard/workbooks.js";
import { OnboardingCanonicalInput, OnboardingCanonicalValueSchema, ONBOARDING_INPUT_EXAMPLE } from "../../../src/models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_GATE_ID, OnboardingRosterSnapshotRowSchema } from "../../../src/models/workflows/onboarding/roster.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { deriveGateResultCheckpointFingerprint } from "../../../src/models/workflow/gates.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { singleAppliedRunId } from "../../support/fixtures/operator-command-fixtures.js";
import { testRunService, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import type { EditableWorkbook } from "../../../src/models/dashboard/workbooks.js";
import type { RunRecord } from "../../../src/models/run/record.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const fixtureProfiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(fixtureProfiles.create);
afterAll(() => fixtureProfiles.close());
afterEach(async () => {
  while (world.openDatabases.length) world.openDatabases.pop()!.close();
  while (world.profiles.length) await world.profiles.pop()!.close();
  while (world.roots.length) rmSync(world.roots.pop()!, { recursive: true, force: true });
});

async function fixture(match: "unique" | "missing" | "duplicate" = "duplicate") {
  const h = await world.createHarness(undefined, { descriptors: [descriptor] });
  const profile = world.profiles.at(-1); assert.ok(profile);
  const profilePath = profile.path;
  const repository = h.database.authority.workbooks;
  const library = createWorkbookLibraryService({ repository, clock: h.clock, sync: unexpectedWorkbookSync });
  const key = "hire@example.test";
  function sheet(id: string, email: string) {
    return { id, name: id, width: ONBOARDING_ROSTER_FIELDS.length, hidden: [], headerRow: 1,
      columnBindings: ONBOARDING_ROSTER_FIELDS.map((fieldId, index) => ({ id: `${id}-${index}`, sourceColumn: index,
        sourceHeader: fieldId, fieldId, basis: "manual" })),
      rows: [{ id: `${id}-header`, cells: ONBOARDING_ROSTER_FIELDS.map(value => ({ value })) },
        { id: `${id}-person`, cells: [email, "Fixture", "Hire", "", null, null, null].map(value => ({ value })) }] };
  }
  const saved = library.create({ name: "Synthetic.xlsx", themes: [], hasFormulas: false,
    sheets: [sheet("people", match === "missing" ? "other@example.test" : key), sheet("archive", match === "duplicate" ? key : "other@example.test")] });
  repository.putType({ id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null });
  library.operatorOperation(saved.libraryId, "declare-type", { kind: "metadata", expectedVersion: 1,
    metadata: { typeId: "onboarding-roster", sharePoint: null } });
  const declared = repository.types().find(type => type.id === "onboarding-roster"); assert.ok(declared);
  repository.putType({ ...declared, defaultWorkbookId: saved.libraryId });
  const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
  let snapshots = 0;
  const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
    descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined }, planTtlMs: 600_000,
    workbooks: { snapshot: value => { snapshots++; return library.snapshot(value); } }, configFingerprint: config.configFingerprint,
    configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  const selection = { entry: 1, typeId: "onboarding-roster", keys: [key], fields: [...ONBOARDING_ROSTER_FIELDS] };
  const request = { workflowId: descriptor.id, submissions: [{ email: key, mode: "new-hire", configuredJobEndDate: "06/30/2027" }],
    dryRun: false, workbookReferences: [selection] };
  const plan = (value: unknown = request) => {
    const wire = planner.plan(value), record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record); return record;
  };
  const start = () => {
    const planned = plan(); assert.equal(planned.refused.length, 0);
    const result = h.kernel.execute(world.startCommand(planned));
    const run = h.database.authority.runs.get(singleAppliedRunId(result)); assert.ok(run); return run;
  };
  function edit(change: (workbook: EditableWorkbook) => void) {
    const record = library.read(saved.libraryId); assert.ok(record);
    const workbook = structuredClone(record.workbook); change(workbook);
    const receipt = library.operatorOperation(saved.libraryId, randomUUID(), { kind: "save", expectedVersion: record.version,
      workbook: encodeEditableWorkbook(workbook) }); assert.equal(receipt.state, "applied");
  }
  function park(run: RunRecord) {
    const ports = testWorkerPorts(h.database, h.clock, { path: profilePath, descriptor, poolIndex: 1 });
    const worker = h.database.authority.workerSlots.list(descriptor.id).find(value => value.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("claim refused");
    assert.equal(claimed.run.envelope.runId, run.envelope.runId);
    const service = testRunService(h.database, h.clock), now = h.clock.now().toISOString();
    const claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
    for (const state of ["validating", "running"] as const) {
      assert.equal(service.workerTransition({ commandId: randomUUID(), runId: run.envelope.runId, claim,
        lifecycle: { state, workerId: worker.workerId, claimedAt: now, heartbeatAt: now } }).state, "applied");
    }
    const parked = service.workerTransition({ commandId: randomUUID(), runId: run.envelope.runId, claim,
      lifecycle: { state: "parked-gate", gateId: ONBOARDING_ROSTER_GATE_ID, parkedAt: now, resumeAt: ONBOARDING_ROSTER_GATE_ID } });
    assert.equal(parked.state, "applied"); if (parked.state !== "applied") throw new Error("park refused");
    h.database.assertWorkerLifecycleRelease(worker.workerId);
    return parked.run;
  }
  const section = (run: RunRecord) => {
    const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    return buildRunWorkbookSection(h.database.authority, current);
  };
  const choice = (run: RunRecord) => {
    const resolution = section(run).referenceChoices?.[0]?.resolution;
    assert.ok(resolution?.state === "available");
    return CommandRequestSchema.parse({ commandId: world.nextCommandId(), requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator", source: "run-detail", family: "run", type: "resolve-workbook-reference-row",
      target: resolution.target, payload: { sheetId: resolution.candidates[0].sheetId, rowId: resolution.candidates[0].rowId } });
  };
  return { ...h, key, library, repository, id: saved.libraryId, selection, request, plan, start, edit, park, section, choice,
    snapshots: () => snapshots };
}

describe("Onboarding captured roster admission and row choice", () => {
  it("binds the default or selected workbook exactly once and retains the immutable typed legal/lived row", async () => {
    const f = await fixture("unique"), run = f.start();
    const input = OnboardingCanonicalValueSchema.parse(run.input.parsed.value);
    assert.equal(input.roster.state, "resolved"); if (input.roster.state !== "resolved") throw new Error("missing row");
    assert.deepEqual(input.roster.row.references, { legalName: { firstName: "Fixture", lastName: "Hire", middleName: "" }, livedName: null });
    assert.equal(input.roster.row.binding.sheetId, "people"); assert.equal(input.roster.row.binding.rowId, "people-person");
    assert.equal(input.roster.row.binding.workbookId, f.id); assert.equal(f.snapshots(), 1);
    const before = canonicalJsonStringify(run.input);
    const type = f.repository.types().find(type => type.id === "onboarding-roster"); assert.ok(type);
    f.repository.putType({ ...type, defaultWorkbookId: null });
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[1].value = "Later"; });
    const stored = f.database.authority.runs.get(run.envelope.runId); assert.ok(stored);
    assert.equal(canonicalJsonStringify(stored.input), before);
    assert.equal(f.section(stored).referenceChoices?.length, 0);
    assert.equal(f.snapshots(), 1);
    const selected = f.plan({ ...f.request, submissions: [{ ...f.request.submissions[0], email: "other@example.test" }],
      workbookReferences: [{ ...f.selection, libraryId: f.id, keys: ["other@example.test"] }] });
    assert.equal(selected.planned.length, 1); assert.equal(selected.refused.length, 0);
    assert.equal(OnboardingCanonicalInput.safeParse(f.request.submissions[0]).success, false);
  });

  it("refuses caller roster authority, wrong key/field/type declarations and malformed legal/lived cells", async () => {
    const f = await fixture("unique");
    for (const request of [
      { ...f.request, submissions: [{ ...f.request.submissions[0], roster: ONBOARDING_INPUT_EXAMPLE.roster }] },
      { ...f.request, workbookReferences: [] },
      { ...f.request, workbookReferences: [{ ...f.selection, keys: ["other@example.test"] }] },
      { ...f.request, workbookReferences: [{ ...f.selection, fields: ["email", "livedName"] }] },
      { ...f.request, workbookReferences: [{ ...f.selection, typeId: "general" }] },
    ]) assert.equal(f.plan(request).planned.length, 0);
    for (const values of [["", "Hire", "", null, null, null], ["Fixture", 4, "", null, null, null],
      ["Fixture", "Hire", "", "Lived", null, null], ["Fixture", "Hire", "", "", "", ""]]) {
      f.edit(workbook => { workbook.sheets[0].rows[1].cells = [f.key, ...values].map(value => ({ value })); });
      assert.equal(f.plan().planned.length, 0);
    }
  });

  it("holds a missing row until its exact key appears in an original worksheet", async () => {
    const f = await fixture("missing"), run = f.park(f.start());
    assert.deepEqual(f.section(run).referenceChoices?.[0]?.resolution,
      { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] });
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key.toUpperCase(); });
    assert.equal(f.section(run).referenceChoices?.[0]?.resolution.state, "unavailable");
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key; });
    const command = f.choice(run);
    assert.equal(f.kernel.execute(command).state, "applied");
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "queued");
    assert.equal(f.section(run).referenceChoices?.[0]?.resolution.state, "resolved");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
  });

  it("rebuilds the chosen cross-sheet values, resumes once and leaves the original start snapshot unchanged", async () => {
    const f = await fixture(), run = f.park(f.start()), original = canonicalJsonStringify(run.input);
    const available = f.section(run).referenceChoices?.[0]?.resolution;
    assert.ok(available?.state === "available"); assert.deepEqual(available.candidates.map(row => row.sheetId), ["people", "archive"]);
    f.edit(workbook => { workbook.sheets[1].rows[1].cells[1].value = "Chosen";
      for (const [index, value] of ["Lived", "Hire", ""].entries()) workbook.sheets[1].rows[1].cells[index + 4].value = value; });
    const request = f.choice(run); assert.ok(request.type === "resolve-workbook-reference-row");
    const command = { ...request, payload: { sheetId: "archive", rowId: "archive-person" } };
    assert.equal(f.kernel.execute(command).state, "applied");
    assert.equal(f.kernel.execute(command).state, "already-applied");
    const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(current.lifecycle.state, "queued"); assert.equal(current.version, run.version + 1);
    assert.equal(canonicalJsonStringify(current.input), original);
    const gate = f.database.authority.gateResults.get(`${run.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const chosen = authenticateOnboardingRosterChoice(f.database.authority, current, gate);
    assert.equal(chosen.references.legalName.firstName, "Chosen"); assert.equal(chosen.references.livedName?.firstName, "Lived");
    assert.equal(chosen.binding.sheetId, "archive"); assert.equal(chosen.binding.workbookVersion, command.target.workbookVersion);
    const hirePlan = descriptorRuntimeNodes(descriptor).find(node => node.id === "hire-plan"); assert.ok(hirePlan?.kind === "task");
    const bound = OnboardingReadHirePlan.input.parse(hirePlan.bind({ input: current.input.parsed.value,
      outputs: { "crm-source": CrmReadHireData.example, "roster-choice": chosen } }));
    assert.deepEqual(bound.roster, chosen);
    f.edit(workbook => { workbook.sheets[1].rows[1].cells[1].value = "Later"; });
    assert.deepEqual(authenticateOnboardingRosterChoice(f.database.authority, current, gate), chosen);
    assert.equal(f.section(current).referenceChoices?.[0]?.resolution.state, "resolved");
    assert.equal(f.kernel.execute({ ...command, commandId: world.nextCommandId() }).state, "rejected");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
    assert.equal(f.snapshots(), 1);
  });

  it("refuses generic gate bypass and binds resolution to exact retained input and native membership", async () => {
    const f = await fixture(), run = f.park(f.start());
    const command = f.choice(run); assert.ok(command.type === "resolve-workbook-reference-row");
    const forged = { ...ONBOARDING_INPUT_EXAMPLE.roster.row, binding: { ...ONBOARDING_INPUT_EXAMPLE.roster.row.binding,
      workbookId: f.id, sheetId: "people", rowId: "people-person" } };
    assert.equal(f.kernel.execute({ ...command, family: "gate", type: "resolve-gate",
      target: { runId: run.envelope.runId, expectedVersion: run.version, gateId: ONBOARDING_ROSTER_GATE_ID },
      payload: { result: { schemaHash: deriveSchemaHash(OnboardingRosterSnapshotRowSchema, "output"), value: forged } } }).state, "rejected");
    for (const target of [
      { ...command.target, referenceDigest: "b".repeat(64) }, { ...command.target, libraryId: "foreign" },
      { ...command.target, key: "other@example.test" }, { ...command.target, typeId: "general" },
      { ...command.target, gateId: "other-gate" }, { ...command.target, runId: randomUUID() }, { ...command.target, expectedVersion: run.version + 1 },
    ]) assert.equal(f.kernel.execute({ ...command, commandId: world.nextCommandId(), target }).state, "rejected");
    const tampered = structuredClone(run); tampered.input.parsed.value = { ...OnboardingCanonicalValueSchema.parse(run.input.parsed.value),
      roster: { ...OnboardingCanonicalValueSchema.parse(run.input.parsed.value).roster, reason: "row-missing" } };
    assert.throws(() => buildRunWorkbookSection(f.database.authority, tampered));
    assert.equal(f.database.authority.gateResults.listByRun(run.envelope.runId).length, 0);
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
  });

  it.each(["revision", "key", "sheet", "type", "fields", "names"] as const)("refuses stale %s authority without resuming or writing", async change => {
    const f = await fixture(), run = f.park(f.start()), command = f.choice(run);
    if (change === "type" || change === "fields") {
      const type = f.repository.types().find(type => type.id === "onboarding-roster"); assert.ok(type);
      f.repository.putType({ ...type, ...(change === "type" ? { keyFieldId: "firstName" } : { fields: ["email"] }) });
    } else f.edit(workbook => {
      if (change === "revision") workbook.name = "Changed.xlsx";
      if (change === "key") workbook.sheets[0].rows[1].cells[0].value = "other@example.test";
      if (change === "sheet") workbook.sheets[0].id = "replacement-sheet";
      if (change === "names") workbook.sheets[0].rows[1].cells[1].value = null;
    });
    const candidate = change === "names" && command.type === "resolve-workbook-reference-row"
      ? { ...command, target: { ...command.target, workbookVersion: f.library.read(f.id)?.version } } : command;
    assert.equal(f.kernel.execute(candidate).state, "rejected");
    assert.equal(f.database.authority.gateResults.listByRun(run.envelope.runId).length, 0);
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
  });

  it("never offers newly added worksheets and authenticates retained choice command/audit evidence", async () => {
    const f = await fixture(), run = f.park(f.start());
    f.edit(workbook => { const added = structuredClone(workbook.sheets[0]); added.id = "new-sheet"; added.name = "New"; workbook.sheets.push(added); });
    const command = f.choice(run); assert.ok(command.type === "resolve-workbook-reference-row");
    assert.equal(f.kernel.execute({ ...command, payload: { sheetId: "new-sheet", rowId: "people-person" } }).state, "rejected");
    const actual = CommandRequestSchema.parse({ ...command, commandId: world.nextCommandId() });
    assert.ok(actual.type === "resolve-workbook-reference-row");
    assert.equal(f.kernel.execute(actual).state, "applied");
    const gate = f.database.authority.gateResults.get(`${run.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(authenticateOnboardingRosterChoice(f.database.authority, current, gate).binding.rowId, "people-person");
    const parsed = OnboardingRosterSnapshotRowSchema.parse(gate.result.value);
    const tampered = { ...gate, result: { ...gate.result, value: { ...parsed, binding: { ...parsed.binding, rowId: "archive-person" } } } };
    assert.throws(() => authenticateOnboardingRosterChoice(f.database.authority, current,
      { ...tampered, checkpointFingerprint: FingerprintSchema.parse(deriveGateResultCheckpointFingerprint(tampered.result)) }));
    const changedNames = { ...gate, result: { ...gate.result, value: { ...parsed,
      references: { ...parsed.references, legalName: { ...parsed.references.legalName, firstName: "Injected" } } } } };
    assert.throws(() => authenticateOnboardingRosterChoice(f.database.authority, current,
      { ...changedNames, checkpointFingerprint: FingerprintSchema.parse(deriveGateResultCheckpointFingerprint(changedNames.result)) }));
    const repositories = f.database.authority;
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories,
      timelineEvents: { ...repositories.timelineEvents, get: () => undefined } }, current, gate));
    const native = (id: string) => repositories.timelineEvents.get(id);
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories,
      timelineEvents: { ...repositories.timelineEvents, get: id => {
        const event = native(id);
        return event?.payload.kind === "span" && event.payload.event.t === "gate.resolved"
          ? { ...event, payload: { ...event.payload, event: { ...event.payload.event, resultHash: "b".repeat(64) } } } : event;
      } } }, current, gate));
    const changedCommand = { ...actual, payload: { sheetId: "archive", rowId: "archive-person" } };
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories,
      commands: { ...repositories.commands, get: () => changedCommand } }, current, gate));
    const audit = repositories.commandAudits.findByCommand(actual.commandId); assert.ok(audit);
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories, commandAudits: {
      ...repositories.commandAudits, findByCommand: () => ({ ...audit, request: changedCommand }),
    } }, current, gate));
  });
});
