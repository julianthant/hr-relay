import { afterAll, afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { createProfileFixtureSet, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { taskId } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { compileWorkflow, defineStepEntries, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { WorkflowAuthor } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowStep, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { CONFIG_SNAPSHOT, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const CLOCK = manualClock(new Date(NOW));
const profiles: Awaited<ReturnType<typeof profileFixtures.create>>[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
});

const Input = z.strictObject({ value: z.string() });
const contract = defineTaskContract({
  id: taskId("workflow:reference-check-plan/read-value"), title: "Read fixture value", effect: "read",
  input: Input, output: Input, errorCodes: ["provider-unavailable"],
  subject: { kind: "none", reason: "Pure start-plan fixture" }, scenarios: [],
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  example: { value: "fixture" },
});
const group = defineWorkflowStep({ key: "reading", label: "Read fixture value" });
const entries = defineStepEntries(group);
const base = {
  id: "reference-check-plan", version: 1, code: "rcp", label: "Reference check plan", icon: "Search", category: "search",
  input: Input, canonicalInput: defineCanonicalInput(Input, Input, [{ value: "fixture" }]), inputSubject: "name", surface: { shape: "single" }, enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (input: z.output<typeof Input>) => input.value },
  presentation: { title: (input: z.output<typeof Input>) => input.value }, scenarios: ["reference-check-plan/read"],
  role: { kind: "standalone" },
  steps: (author: WorkflowAuthor<typeof Input>) => {
    const read = author.task(entries.task("reading", contract, { replay: "checkpoint" }), [], ({ input }) => input);
    return { steps: [[group, [read]]] as const, result: author.result(Input, [read], ({ outputs }) => outputs.reading) };
  },
} as const;
const CHECK = { id: "reference-check", keyFieldId: "eid" };
const checkOnly = compileWorkflow(defineWorkflow({ ...base, workbookCheck: CHECK })).descriptor;
const requiredAndCheck = compileWorkflow(defineWorkflow({ ...base, requiredWorkbookFields: ["eid", "fullName"],
  workbookReference: { id: "plan-roster", keyFieldId: "eid", mode: "keys", writableFields: [] }, referenceKeys: () => [], workbookCheck: CHECK })).descriptor;
const neither = compileWorkflow(defineWorkflow(base)).descriptor;

async function harnessFor(descriptor: AnyWorkflowDescriptor) {
  const profile = await profileFixtures.create(); profiles.push(profile);
  const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, CLOCK,
    undefined, undefined, undefined, boundProfileCredentials(profile.admission));
  databases.push(database);
  database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, configSnapshotId: UUID_4 });
  const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock: CLOCK, sync: unexpectedWorkbookSync });
  const service = createStartPlanService({ authority: database, authorityRead: database, workbooks: library,
    descriptors: { resolve: workflowId => workflowId === String(descriptor.id) ? descriptor : undefined },
    clock: CLOCK, ids: sequentialIdFactory("b"), planTtlMs: 600_000, configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: UUID_4, plannedBy: "local-operator" });
  const sheet = (name: string, fields: readonly string[]) => {
    const saved = library.create({ name, themes: [], hasFormulas: false, sheets: [{ id: "people", name: "People", width: fields.length, hidden: [], headerRow: 1,
      columnBindings: fields.map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
      rows: [{ id: "header", cells: fields.map(value => ({ value })) }] }] });
    return { libraryId: saved.libraryId, versionId: library.libraryVersion(saved.libraryId).version.id, sheetId: "people", expectedVersion: library.read(saved.libraryId).version };
  };
  const plan = (workbookReferences?: readonly Record<string, unknown>[]) => service.plan({ workflowId: String(descriptor.id), submissions: [{ value: "fixture" }], dryRun: false,
    ...(workbookReferences === undefined ? {} : { workbookReferences }) });
  return { sheet, plan };
}
const types = (wire: Awaited<ReturnType<typeof harnessFor>>["plan"] extends (...args: never[]) => infer Plan ? Plan : never) =>
  wire.planned.map(planned => (planned.workbookReferences ?? []).map(reference => [reference.type.id, reference.type.name, reference.type.fields]));

describe("optional reference check picks in a start plan", () => {
  it("plans a workflow that declares only the check with no pick at all", async () => {
    const h = await harnessFor(checkOnly);
    const wire = h.plan();
    assert.equal(wire.refused.length, 0, JSON.stringify(wire.refused));
    assert.deepEqual(types(wire), [[]]);
  });

  it("captures each picked check spreadsheet by its Employee ID column, with or without a name column", async () => {
    const h = await harnessFor(checkOnly);
    const withName = h.sheet("Fall roster", ["eid", "fullName"]), eidOnly = h.sheet("Badge list", ["email", "eid"]);
    const wire = h.plan([{ entry: 1, typeId: "reference-check", ...withName }, { entry: 1, typeId: "reference-check", ...eidOnly }]);
    assert.equal(wire.refused.length, 0, JSON.stringify(wire.refused));
    assert.deepEqual(types(wire), [[["reference-check", "Fall roster", ["eid"]], ["reference-check", "Badge list", ["eid"]]]]);
  });

  it("refuses a check pick whose sheet has no Employee ID column, one named twice, and one with no type", async () => {
    const h = await harnessFor(checkOnly);
    const noKey = h.sheet("Contacts", ["email", "fullName"]), roster = h.sheet("Fall roster", ["eid"]);
    for (const picks of [[{ entry: 1, typeId: "reference-check", ...noKey }],
      [{ entry: 1, typeId: "reference-check", ...roster }, { entry: 1, typeId: "reference-check", ...roster }],
      [{ entry: 1, ...roster }], [{ entry: 1, typeId: "plan-roster", ...roster }]]) {
      const wire = h.plan(picks);
      assert.equal(wire.planned.length, 0);
      assert.deepEqual(wire.refused.map(refusal => refusal.code), ["capability-unavailable"]);
    }
  });

  it("carries the required reference and the optional check side by side", async () => {
    const h = await harnessFor(requiredAndCheck);
    const roster = h.sheet("Plan roster", ["eid", "fullName"]), extra = h.sheet("Badge list", ["eid"]);
    const requiredOnly = h.plan([{ entry: 1, ...roster }]);
    assert.equal(requiredOnly.refused.length, 0, JSON.stringify(requiredOnly.refused));
    assert.deepEqual(types(requiredOnly), [[["plan-roster", "Plan roster", ["eid", "fullName"]]]]);
    const both = h.plan([{ entry: 1, typeId: "reference-check", ...extra }, { entry: 1, typeId: "plan-roster", ...roster }]);
    assert.equal(both.refused.length, 0, JSON.stringify(both.refused));
    assert.deepEqual(types(both), [[["plan-roster", "Plan roster", ["eid", "fullName"]], ["reference-check", "Badge list", ["eid"]]]]);
    const checkWithoutRequired = h.plan([{ entry: 1, typeId: "reference-check", ...extra }]);
    assert.deepEqual(checkWithoutRequired.refused.map(refusal => refusal.code), ["capability-unavailable"]);
  });

  it("still refuses any pick for a workflow that declares neither", async () => {
    const h = await harnessFor(neither);
    const roster = h.sheet("Fall roster", ["eid"]);
    assert.deepEqual(h.plan([{ entry: 1, typeId: "reference-check", ...roster }]).refused.map(refusal => refusal.code), ["capability-unavailable"]);
    assert.equal(h.plan().refused.length, 0);
  });
});
