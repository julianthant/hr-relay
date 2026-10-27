import { RunEvidenceReceiptSchema } from "../../../../src/models/trust/evidence.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { FICTIONAL_PERSON, seedPersonLookupPresentation } from "../../../support/fixtures/person-lookup-presentation.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);
describe("served Person Lookup identity presentation", () => {
  it.each([
    { name: "found employee ID", input: { emplId: FICTIONAL_PERSON.eid }, state: "active", title: "Quillan, Petra A." },
    { name: "found lower-case name", input: { name: "quillan, petra a." }, state: "active", title: "Quillan, Petra A." },
    { name: "not-found employee ID", input: { emplId: FICTIONAL_PERSON.eid }, state: "not-found", title: FICTIONAL_PERSON.eid },
    { name: "not-found upper-case name", input: { name: "QUILLAN, PETRA A." }, state: "not-found", title: "Quillan, Petra A." },
    { name: "not-found protected test subject", input: { emplId: FICTIONAL_PERSON.eid }, state: "not-found", title: FICTIONAL_PERSON.eid, protectedInput: true },
    { name: "found protected test subject", input: { emplId: FICTIONAL_PERSON.eid }, state: "active", title: "Quillan, Petra A.", protectedInput: true },
    { name: "Match hides identifiers", input: { mode: "match", lastName: "QUILLAN", firstName: "PETRA A.", dob: "2/19/2030", ssn: "000112222" }, state: "found", title: "Quillan, Petra A." },
  ] as const)("uses the resolved name or typed search for $name", async options => {
    const { row } = seedPersonLookupPresentation(await world({ descriptors: { resolve: () => personLookupDescriptor } }), { ...options, input: PersonLookupInput.parse(options.input) });
    const surface = row(); assert.ok(surface);
    assert.equal(surface.title, options.title);
    if (surface.facts.state === "present") for (const fact of surface.facts.value) {
      if (["Name", "Matched Name"].includes(fact.label)) assert.equal(fact.value, "Quillan, Petra A.");
    }
    if (options.state === "not-found") assert.equal(surface.subtitle.state, "absent");
    else assert.deepEqual(surface.subtitle, { state: "present", value: FICTIONAL_PERSON.eid });
    assert.doesNotMatch(JSON.stringify({ title: surface.title, subtitle: surface.subtitle, facts: surface.facts }), /000112222|2\/19\/2030/u);
  });
});


it("shows an allowed resolved EID subtitle for a protected test subject", async () => {
  const { row } = seedPersonLookupPresentation(await world({ descriptors: { resolve: () => personLookupDescriptor } }), { protectedInput: true });
  const surface = row(); assert.ok(surface);
  assert.deepEqual(surface.subtitle, { state: "present", value: FICTIONAL_PERSON.eid });
});

it("keeps the served detail header equal to the resolved Queue title", async () => {
  const { buildRunDetail } = await import("../../../../src/backend/runs/queries/run-detail.js");
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { row, run } = seedPersonLookupPresentation(w, { protectedInput: true });
  const detail = buildRunDetail({ runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot,
    projection: w.projection, authority: w.authority, descriptors: { resolve: () => personLookupDescriptor } }, run.envelope.runId);
  assert.equal(detail.header.title, "Quillan, Petra A.");
  assert.equal(detail.header.title, row()?.title);
});

it("does not use unverified or unrelated result names and EIDs", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  receipt.verification = [];
  assert.equal(row()?.title, FICTIONAL_PERSON.eid);
  assert.equal(row()?.subtitle.state, "absent");
});

it("keeps a protected document binding outside the EID display permission", async () => {
  const { allowsSubjectIdentity, resolveResultTitle } = await import("../../../../src/backend/runs/projections/run-subject-title.js");
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { run } = seedPersonLookupPresentation(w, { protectedInput: true });
  const protectedRun = { ...run, input: { ...run.input, parsed: { ...run.input.parsed, protectedBindings: [{ kind: "test-data-local" as const,
    inputPath: "documentNumber" as const, name: "separationsKualiFinalizationCanaryDocumentNumber" as const, sourceId: run.envelope.runId }] } } };
  assert.equal(allowsSubjectIdentity(protectedRun, personLookupDescriptor), false);
  assert.equal(resolveResultTitle(personLookupDescriptor, protectedRun, w.authority.receipts.get(run.envelope.runId)), undefined);
});

it("refuses every foreign receipt identity before projecting a resolved name", async () => {
  const { resolveResultTitle } = await import("../../../../src/backend/runs/projections/run-subject-title.js");
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  for (const replacement of [
    { runId: "00000000-0000-4000-8000-000000000099" }, { traceId: "pl-100000-0099" }, { attempt: 2 },
    { workflowId: "another-workflow" }, { descriptorFingerprint: "e".repeat(64) }, { configFingerprint: "f".repeat(64) },
  ]) assert.throws(() => resolveResultTitle(personLookupDescriptor, run, RunEvidenceReceiptSchema.parse({ ...receipt, ...replacement })), /result-title-receipt-identity-mismatch/u);
});

it("preserves an operation group title when its workflow declares a person result title", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  queuedEventOf(w, { seed: 1, shape: "operation", title: "Onboarding packet — 3 people" });
  const surface = w.projection.buildDashboardDayWire("2026-08-03").queueSurfaces[0];
  assert.ok(surface);
  assert.equal(surface.surfaceKind, "operation");
  assert.equal(surface.title, "Onboarding packet — 3 people");
});
