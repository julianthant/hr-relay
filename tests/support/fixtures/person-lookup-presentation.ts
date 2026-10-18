import { PersonLookupInput, personLookupTitle, personLookupSearchText, type PersonLookupInputValue } from "../../../src/models/workflows/person-lookup/input.js";
import { ActiveStatusOutcomeSchema } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { RunEvidenceReceiptSchema } from "../../../src/models/trust/evidence.js";
import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../src/models/trust/evidence-identity.js";
import { instantOffsetOf, receiptWithOutputOf, uuidOf, type DashboardWorld } from "../helpers/backend/dashboard-harness.js";
import { createSeededDashboardWorld } from "../helpers/seeded-dashboard-world.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

export const FICTIONAL_PERSON = { eid: "10000001", name: "QUILLAN, PETRA A.", department: "CAMPUS DINING OPERATIONS", startDate: "3/14/2031" } as const;

export function seedPersonLookupPresentation(world: DashboardWorld, options: {
  seed?: number; input?: PersonLookupInputValue; state?: "active" | "inactive" | "found" | "not-found" | "not-found-in-ucpath";
  protectedInput?: boolean; attempt?: number; enqueuedAt?: string; itemId?: string;
} = {}) {
  const seed = options.seed ?? 80;
  const input = PersonLookupInput.parse(options.input ?? { emplId: FICTIONAL_PERSON.eid });
  const state = options.state ?? (input.mode === "match" ? "found" : "active");
  const found = !["not-found", "not-found-in-ucpath"].includes(state);
  const outcome = ActiveStatusOutcomeSchema.parse({ ucpathSelection: found ? "resolved" : "not-found", datesEid: null,
    state, reason: "", code: null, hdh: found ? true : null, candidateEids: [], details: {
      search: personLookupSearchText(input), name: found ? FICTIONAL_PERSON.name : null, eid: found ? FICTIONAL_PERSON.eid : null,
      department: found ? FICTIONAL_PERSON.department : null, hrStatus: found ? state === "inactive" ? "Inactive" : "Active" : null,
      ucpath: found ? "Found" : "Not found", crm: input.crmCheck ? found ? "Found" : "Not found" : "Not checked",
      startDate: found && input.crmCheck ? FICTIONAL_PERSON.startDate : null,
      endDate: state === "inactive" ? "4/25/2031" : null, terminationReason: state === "inactive" ? "Appointment ended" : null,
      foundInUcpath: input.mode === "match" ? found : null, matchedEid: input.mode === "match" && found ? FICTIONAL_PERSON.eid : null,
      matchedName: input.mode === "match" && found ? FICTIONAL_PERSON.name : null,
    } });
  const { queuedEventOf, runRecordOf } = createSeededDashboardWorld();
  queuedEventOf(world, { seed, descriptor: personLookupDescriptor, title: options.protectedInput ? "Protected test subject" : personLookupTitle(input),
    attempt: options.attempt, enqueuedAt: options.enqueuedAt });
  const base = runRecordOf({ seed, descriptor: personLookupDescriptor, attempt: options.attempt, enqueuedAt: options.enqueuedAt,
    lifecycle: { state: "terminal", outcome: "done", endedAt: options.enqueuedAt === undefined ? instantOffsetOf(0, 60_000) : new Date(Date.parse(options.enqueuedAt) + 60_000).toISOString() } });
  const run = RunRecordSchema.parse({ ...base,
    envelope: { ...base.envelope, ...(options.itemId === undefined ? {} : { itemId: options.itemId }) },
    input: { ...base.input, raw: input, parsed: { ...base.input.parsed, value: input,
      protectedBindings: options.protectedInput ? [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: uuidOf(99) }] : [] } },
  });
  world.authority.put(run);
  const values = [
    ...Object.entries(outcome).filter(([key]) => key !== "details").map(([key, value]) => ({ path: `activeStatus.${key}`, field: key, value })),
    ...Object.entries(outcome.details).map(([key, value]) => ({ path: `activeStatus.details.${key}`, field: key, value })),
    { path: "crmDates.state", field: "state", value: "not-requested" },
  ];
  const receipt = receiptWithOutputOf({ seed, outputs: values });
  receipt.configFingerprint = run.envelope.configFingerprint;
  receipt.descriptorFingerprint = run.envelope.contractFingerprint;
  receipt.attempt = run.envelope.attempt;
  receipt.output.forEach((fact, index) => { fact.id = deriveEvidenceEntryId(receipt.receiptId, "output", values[index].path); });
  receipt.verification = [{ id: deriveEvidenceEntryId(receipt.receiptId, "verification", "completion.terminal-result"),
    obligation: "completion.terminal-result", mandatory: true, verdict: "verified", evidence: receipt.output.map(fact => evidenceEntryRef(fact.id)) }];
  world.authority.receipts.set(run.envelope.runId, RunEvidenceReceiptSchema.parse(receipt));
  return { run, outcome, row: () => world.projection.buildDashboardDayWire(options.enqueuedAt?.slice(0, 10) ?? "2026-08-03").queueSurfaces.find(row => row.runId === run.envelope.runId) };
}
