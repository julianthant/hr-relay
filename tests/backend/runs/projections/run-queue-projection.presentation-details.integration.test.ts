import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../../src/models/trust/evidence-identity.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { FICTIONAL_PERSON, seedPersonLookupPresentation } from "../../../support/fixtures/person-lookup-presentation.js";
import { derivePersonLookupOutcome, resolvePersonLookupIdentity } from "../../../../src/rules/matching/person-lookup.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

describe("served Person Lookup declared Queue details", () => {
  it.each(["active", "inactive", "found"] as const)("shows only the EID detail and a separate Outcome badge for %s", state => {
    const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
    const input = state === "found" ? PersonLookupInput.parse({ mode: "match", lastName: "quillan", firstName: "petra", dob: "2/19/2030", crmCheck: true }) : undefined;
    const { row } = seedPersonLookupPresentation(w, { state, input });
    const surface = row(); assert.ok(surface);
    assert.deepEqual(surface.outcome, { label: state === "active" ? "Active" : state === "inactive" ? "Inactive" : "Found", tone: state === "inactive" ? "neutral" : "success" });
    assert.equal(surface.facts.state, "present");
    if (surface.facts.state !== "present") return;
    assert.equal(surface.facts.value.find(fact => fact.label === "EID")?.value, FICTIONAL_PERSON.eid);
    assert.ok(surface.facts.value.every(fact => fact.value !== "null" && fact.value !== ""));
    assert.ok(surface.facts.value.every(fact => !["state", "Outcome", "candidateEids", "code", "datesEid", "hdh", "reason", "ucpathSelection"].includes(fact.label)));
    assert.deepEqual(surface.facts.value, [{ label: "EID", value: FICTIONAL_PERSON.eid }]);
  });
});

it("projects the confirmed Match person's EID from the derived terminal result", () => {
  const input = PersonLookupInput.parse({ mode: "match", lastName: "Quillan", firstName: "Petra", dob: "2/19/2030" });
  const hit = { emplId: EidSchema.parse("10000002"), name: FICTIONAL_PERSON.name };
  const match = { hits: [hit], confirmed: [hit], dropped: [] };
  const identity = resolvePersonLookupIdentity({ input, match });
  const outcome = derivePersonLookupOutcome({ input, identity, match });
  assert.equal(outcome.details.eid, "10000002");
  assert.equal(outcome.details.matchedEid, "10000002");
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { row, run } = seedPersonLookupPresentation(w, { input });
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  const eid = receipt.output.find(fact => fact.id === deriveEvidenceEntryId(receipt.receiptId, "output", "activeStatus.details.eid"));
  assert.ok(eid?.state === "satisfied" && eid.value.state === "allowed");
  eid.value.value = outcome.details.eid;
  assert.deepEqual(row()?.facts, { state: "present", value: [{ label: "EID", value: "10000002" }] });
  assert.deepEqual(row()?.outcome, { label: "Found", tone: "success" });
});

it("withholds details without terminal verification and never matches a raw leaf name", () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  const eid = receipt.output.find(fact => fact.id === deriveEvidenceEntryId(receipt.receiptId, "output", "activeStatus.details.eid")); assert.ok(eid);
  eid.id = deriveEvidenceEntryId(receipt.receiptId, "output", "unrelated.eid");
  assert.equal(row()?.facts.state, "absent");
  eid.id = deriveEvidenceEntryId(receipt.receiptId, "output", "activeStatus.details.eid");
  receipt.verification = [];
  assert.equal(row()?.facts.state, "absent");
});

it("requires each displayed output to belong to its exact verification evidence", () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  const eid = deriveEvidenceEntryId(receipt.receiptId, "output", "activeStatus.details.eid");
  receipt.verification[0].evidence = receipt.verification[0].evidence.filter(ref => ref !== evidenceEntryRef(eid));
  assert.equal(row()?.facts.state, "absent");
});

it("omits undeclared mode and termination fields even when their values are retained", () => {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  for (const field of ["endDate", "terminationReason", "foundInUcpath", "matchedEid", "matchedName"]) {
    const fact: (typeof receipt.output)[number] | undefined = receipt.output.find(entry => entry.id === deriveEvidenceEntryId(receipt.receiptId, "output", `activeStatus.details.${field}`));
    assert.ok(fact?.state === "satisfied" && fact.value.state === "allowed");
    fact.value.value = "not applicable";
  }
  const facts = row()?.facts; assert.ok(facts?.state === "present");
  assert.deepEqual(facts.value.map(fact => fact.label), ["EID"]);
});

it("reads declared node details only from this receipt's verified observation IDs", () => {
  const descriptor = { ...personLookupDescriptor, titleProjection: undefined, outcomeProjection: undefined, subtitleProjection: undefined,
    details: [{ key: "name", label: "Name", source: { nodeId: "active-status", fieldPath: "details.name" }, display: "text" as const }] };
  const w = world({ descriptors: { resolve: () => descriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  const output = receipt.output.find(fact => fact.id === deriveEvidenceEntryId(receipt.receiptId, "output", "activeStatus.details.name"));
  assert.ok(output?.state === "satisfied");
  const observation = { ...output, id: deriveEvidenceEntryId(receipt.receiptId, "observation", "active-status.details.name") };
  receipt.output = [];
  receipt.observations.push(observation);
  receipt.verification.push({ id: deriveEvidenceEntryId(receipt.receiptId, "verification", "node.active-status"),
    obligation: "node.active-status", mandatory: true, verdict: "verified", evidence: [evidenceEntryRef(observation.id)] });
  assert.deepEqual(row()?.facts, { state: "present", value: [{ label: "Name", value: FICTIONAL_PERSON.name }] });
  receipt.observations = [];
  assert.equal(row()?.facts.state, "absent");
});

it("refuses foreign receipt identity independently of outcome and subtitle projections", () => {
  const descriptor = { ...personLookupDescriptor, titleProjection: undefined, outcomeProjection: undefined, subtitleProjection: undefined,
    details: [{ key: "name", label: "Name", source: { kind: "result" as const, fieldPath: "activeStatus.details.name" }, display: "text" as const }] };
  const w = world({ descriptors: { resolve: () => descriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  receipt.configFingerprint = run.envelope.contractFingerprint;
  assert.notEqual(receipt.configFingerprint, run.envelope.configFingerprint);
  assert.throws(row, /detail-receipt-identity-mismatch/u);
});

it("withholds DOB and SSN from Match details while keeping only the EID", () => {
  const input = PersonLookupInput.parse({ mode: "match", lastName: "Quillan", firstName: "Petra A.", dob: "2/19/2030", ssn: "000112222" });
  const { row } = seedPersonLookupPresentation(world({ descriptors: { resolve: () => personLookupDescriptor } }), { input });
  const surface = row(); assert.ok(surface);
  assert.doesNotMatch(JSON.stringify(surface.facts), /2\/19\/2030|000112222/u);
  assert.equal(surface.facts.state, "present");
  if (surface.facts.state === "present") assert.deepEqual(surface.facts.value, [{ label: "EID", value: FICTIONAL_PERSON.eid }]);
});

it.each([
  { empty: true, missing: false, reason: "this run's evidence receipt records no output fact" },
  { empty: true, missing: true, reason: "this run's evidence receipt records no output fact" },
  { empty: false, missing: false, reason: "this workflow declares no detail fields" },
  { empty: false, missing: true, reason: "this workflow's detail declaration is unavailable" },
])("explains absent details with empty output $empty and unavailable descriptor $missing", ({ empty, missing, reason }) => {
  const descriptor = { ...personLookupDescriptor, titleProjection: undefined, outcomeProjection: undefined,
    subtitleProjection: undefined, details: [] };
  const w = world({ descriptors: { resolve: () => missing ? undefined : descriptor } });
  const { row, run } = seedPersonLookupPresentation(w);
  const receipt = w.authority.receipts.get(run.envelope.runId); assert.ok(receipt);
  if (empty) receipt.output = [];
  assert.deepEqual(row()?.facts, { state: "absent", reason });
});
