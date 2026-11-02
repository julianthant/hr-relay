import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fixture from "../../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { createDeterministicUcpathContactPage } from "../../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { interpretContactPage } from "../../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { readEmergencyContactsTask } from "../../../../../src/backend/systems/ucpath/tasks/read-emergency-contacts.js";
import { stageEmergencyContactTask } from "../../../../../src/backend/systems/ucpath/tasks/stage-emergency-contact.js";
import { matchEmergencyContactTask } from "../../../../../src/backend/systems/ucpath/tasks/match-emergency-contact.js";
import { ucpathStore } from "../../../../../src/backend/systems/ucpath/task-registry.js";
import { UcpathReadEmergencyContacts, UcpathMatchEmergencyContact } from "../../../../../src/models/systems/ucpath/contact-tasks.js";
import { UcpathContactRefusedError, UcpathContactRefusalCodeSchema, UcpathEmergencyContactInputSchema } from "../../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageSnapshotSchema } from "../../../../../src/models/ui/ucpath-emergency-contact.js";
import { ERROR_CATALOG, failureCodeFromTaskCode } from "../../../../../src/models/failures/error-catalog.js";
import { createTaskProvenanceCollector } from "../../../../../src/backend/runs/provenance/task-provenance.js";
import { defineWorkflow } from "../../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../../src/workflow-kit/validation/module-role.js";
import { defineCanonicalInput } from "../../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../../src/models/workflow/presentation.js";
import { compileFixtureWorkflow } from "../../../../support/fixtures/workflow-definition-fixtures.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";

const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
const page = UcpathContactPageSnapshotSchema.parse(fixture.page);
const before = interpretContactPage(page, input);
const common = {
  signal: new AbortController().signal,
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  fail: (code: string): never => { throw new Error(code); },
  captureScreenshot: async () => undefined,
};
function harness(initial = page) {
  const port = createDeterministicUcpathContactPage({ initial });
  const points: DataPoint[] = [];
  const driver = createDeterministicUcpathPersonOrgDriver(undefined, undefined, port);
  const ctx = { ...common, driver, recordData: (value: DataPoint | readonly DataPoint[]) => {
    if ("direction" in value) points.push(value); else points.push(...value);
  } };
  return { port, points, ctx };
}

const definition = defineWorkflow({
  id: "fixture-contact-read", version: 1, code: "fcr", label: "Fixture Contact Read", summary: "Synthetic contact provenance proof.",
  icon: "Search", category: "search", input: UcpathReadEmergencyContacts.input,
  canonicalInput: defineCanonicalInput(UcpathReadEmergencyContacts.input, UcpathReadEmergencyContacts.input, [{ emplId: input.emplId, expectedName: input.expectedName }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], role: defineWorkflowRole({ kind: "standalone" }), scenarios: ["fixture-contact-read/happy"],
  identity: { matchKey: subject => subject.emplId }, presentation: { title: subject => subject.expectedName },
  steps: ({ task, result }) => {
    const read = task({ id: "read", label: "Read", replay: "checkpoint", contract: UcpathReadEmergencyContacts }, [], ({ input: subject }) => subject);
    return { steps: [[{ key: "contacts", label: "Contacts" }, [read]]],
      result: result(UcpathReadEmergencyContacts.output, [read], ({ outputs }) => outputs.read) };
  },
});

describe("UCPath contact task implementations awaiting scenario binding", () => {
  it("records every read leaf through the real provenance collector", async () => {
    const h = harness();
    const descriptor = compileFixtureWorkflow(definition).descriptor;
    const collector = createTaskProvenanceCollector({ descriptor, canonicalInput: { emplId: input.emplId, expectedName: input.expectedName },
      execution: { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "fcr-120000-aaaa", attempt: 1,
        workflowId: descriptor.id, nodeId: "read", taskId: UcpathReadEmergencyContacts.id },
      upstreamEvidence: { checkpoints: [], skippedTasks: [] }, clock: manualClock(new Date(page.observedAt)), onRecord: () => undefined,
    });
    const output = await readEmergencyContactsTask.impl.run({ input, ctx: { ...h.ctx, recordData: collector.recordData } });
    const evidence = collector.finalizeRead(output);
    assert.equal(evidence.provenance.some(point => point.path === "contacts.rows"), true);
    assert.equal(evidence.provenance.every(point => point.source === "live"), true);
    assert.equal(output.contacts.displayedName, input.expectedName);
    assert.equal(Object.hasOwn(ucpathStore.tasks, "readEmergencyContacts"), false);
    assert.equal(Object.hasOwn(ucpathStore.tasks, "stageEmergencyContact"), false);
    assert.equal(Object.hasOwn(ucpathStore.tasks, "matchEmergencyContact"), false);
  });

  it("stages a nonempty addition without any Save operation", async () => {
    const h = harness();
    const output = await stageEmergencyContactTask.impl.run({ input: { ...input, before }, ctx: h.ctx });
    assert.equal(output.contacts.observation, "staged");
    assert.equal(output.contacts.rows.filter(row => row.kind === "contact").length, 2);
    assert.equal(h.port.actions.some(action => action.includes("save")), false);
    assert.deepEqual(h.points, [{ direction: "read", field: "contacts", value: output.contacts }]);
  });

  it("compares a fresh complete persisted effect without granting receipt or retry authority", async () => {
    const h = harness(UcpathContactPageSnapshotSchema.parse({ ...page, rows: [page.rows[0], fixture.savedRow], observedAt: "2026-11-01T12:01:00.000Z" }));
    const output = await matchEmergencyContactTask.impl.run({ input: { ...input, before }, ctx: h.ctx });
    assert.equal(output.state, "present");
    assert.equal("writeSafety" in UcpathMatchEmergencyContact, false);
    assert.deepEqual(h.points, [{ direction: "read", field: "state", value: "present" }, { direction: "read", field: "contacts", value: output.contacts }]);
  });

  it("maps every named driver refusal to a declared task code and dashboard text", async () => {
    for (const code of UcpathContactRefusalCodeSchema.options) {
      const h = harness();
      const ctx = { ...h.ctx, driver: { ...h.ctx.driver, readEmergencyContacts: async (): Promise<never> => { throw new UcpathContactRefusedError(code); } } };
      await assert.rejects(readEmergencyContactsTask.impl.run({ input, ctx }), new RegExp(code, "u"));
      assert.equal(UcpathReadEmergencyContacts.errorCodes.includes(code), true);
      assert.equal(Object.hasOwn(ERROR_CATALOG, failureCodeFromTaskCode(code)), true);
      assert.deepEqual(h.points, []);
    }
  });

  it("refuses contact calls on unrelated UCPath fixtures instead of inventing contacts", async () => {
    const driver = createDeterministicUcpathPersonOrgDriver();
    await assert.rejects(driver.readEmergencyContacts(input), /explicit contact page observations/u);
    await assert.rejects(driver.stageEmergencyContact(input, before), /explicit contact page observations/u);
  });
});
