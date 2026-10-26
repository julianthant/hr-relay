import { createContentAddressedArtifactWriter } from "../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createDiagnosticCaptureService } from "../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createRunBrowserScreenshotCapture } from "../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { buildQueuedRun } from "../../../src/backend/runs/start/enqueue.js";
import { buildRerunPlan } from "../../../src/backend/runs/start/rerun.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { recordBrowserAction } from "../../../src/backend/systems/browser-shared/action-notes.js";
import { BrowserLoginError, DuoTerminalRefusalError } from "../../../src/backend/systems/browser-shared/login-contract.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { ReadOnboardingDatesOutputSchema } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { searchPersonOrgWithPagePort, assignmentDetailsToCells, type PersonOrgDetail } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { searchPersonMatchWithPort } from "../../../src/backend/systems/ucpath/driver/person-match-operation.js";
import { PersonLookupResultSchema } from "../../../src/workflows/person-lookup/workflow.js";
import { PersonLookupInput, PersonLookupMatchInputError, parsePersonLookupRequest } from "../../../src/models/workflows/person-lookup/input.js";
import { SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import { SearchPersonMatchOutputSchema } from "../../../src/models/systems/ucpath/search-person-match.js";
import { CrmDiscoveredRecordSchema } from "../../../src/models/systems/crm/search-onboarding-records.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import type { z } from "zod";
import { WorkerIdSchema, WorkflowIdSchema, FingerprintSchema } from "../../../src/rules/identity/ids.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
const candidate = UcpathCandidateSchema.parse({ emplId: "10000001", name: "Example, Person", department: "Housing Dining Hospitality", jobTitle: "Assistant", employeeStatus: "active", hdh: true,
  hrStatus: "Active", startDate: "06/15/2026", effectiveDate: "07/01/2026", terminationDate: "", terminationReason: "" });
const other = UcpathCandidateSchema.parse({ ...candidate, emplId: "10000002" });
const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1", emplId: candidate.emplId, name: candidate.name,
  department: candidate.department, firstDayOfService: "07/01/2026", dateSigned: "06/25/2026" });
const miss = SearchPersonOrgOutputSchema.parse({ results: [], selection: { status: "not-found", selected: null, candidateEids: [], searchName: "Example, Person" } });
function searchResult(candidates: readonly z.output<typeof UcpathCandidateSchema>[]) {
  return SearchPersonOrgOutputSchema.parse({ results: candidates, selection: candidates.length > 1
    ? { status: "ambiguous", selected: null, candidateEids: candidates.map((person) => person.emplId), searchName: "Example, Person" }
    : candidates[0] === undefined ? miss.selection : { status: "resolved", selected: candidates[0], candidateEids: [candidates[0].emplId] } });
}
interface Case {
  id: string; input?: unknown; candidates?: readonly z.output<typeof UcpathCandidateSchema>[];
  records?: readonly z.output<typeof CrmDiscoveredRecordSchema>[]; recovered?: boolean;
  matches?: z.output<typeof SearchPersonMatchOutputSchema>; state: string; code?: string; crm?: string;
  dates?: boolean; ucpathFailure?: boolean; crmFailure?: boolean; reopenFailure?: boolean; onCrmSearch?: () => void;
}
const matchInput = { mode: "match", lastName: "Example", firstName: "Person", dob: "01/15/2000", ssn: "123456789" };
const hit = { emplId: candidate.emplId, name: candidate.name };
const cases: readonly Case[] = [
  { id: "S1", state: "active", crm: "Found" },
  { id: "S2", candidates: [{ ...candidate, employeeStatus: "terminated", hrStatus: "Terminated", terminationDate: "09/01/2026", terminationReason: "Resigned" }], state: "inactive" },
  { id: "S3", candidates: [{ ...candidate, department: "Engineering", hdh: false }], state: "active" },
  { id: "S4", candidates: [], state: "crm-only" },
  { id: "S5", candidates: [], records: [], state: "not-found", code: "PERSON_LOOKUP_NOT_FOUND" },
  { id: "S6", input: { name: candidate.name }, state: "active" },
  { id: "S7", input: { name: candidate.name }, candidates: [candidate, other], state: "active" },
  { id: "S8", input: { name: candidate.name }, candidates: [candidate, other], records: [], state: "multiple-matches", code: "PERSON_LOOKUP_MULTIPLE_MATCHES" },
  { id: "S9", input: { name: candidate.name }, candidates: [], recovered: true, state: "active" },
  { id: "S10", input: { name: candidate.name }, candidates: [], state: "crm-only" },
  { id: "S11", input: { name: candidate.name }, candidates: [], records: [record, { ...record, recordId: "ONB-2", emplId: other.emplId }], state: "multiple-matches", code: "PERSON_LOOKUP_MULTIPLE_MATCHES" },
  { id: "S12", input: { name: candidate.name }, candidates: [], records: [], state: "not-found", code: "PERSON_LOOKUP_NOT_FOUND" },
  { id: "S13", input: { name: candidate.name }, candidates: [{ ...candidate, department: "Engineering", hdh: false }], state: "active" },
  { id: "S14", candidates: [{ ...candidate, employeeStatus: "unknown", hrStatus: "Unreadable" }], state: "undetermined", code: "PERSON_LOOKUP_EMPLOYMENT_STATUS_UNDETERMINED" },
  { id: "S15", input: { emplId: candidate.emplId, crmCheck: false }, state: "active", crm: "Not checked" },
  { id: "S16", input: { emplId: candidate.emplId, includeCrmDates: true }, state: "active", dates: true },
  { id: "M1", input: matchInput, matches: { hits: [hit], confirmed: [hit], dropped: [] }, state: "found", crm: "Not checked" },
  { id: "M1b", input: matchInput, matches: { hits: [hit], confirmed: [], dropped: [{ ...hit, reason: "Person Org name does not match" }] }, state: "not-found-in-ucpath", crm: "Not checked" },
  { id: "M2", input: matchInput, matches: { hits: [], confirmed: [], dropped: [] }, state: "not-found-in-ucpath", crm: "Not checked" },
  { id: "M3", input: matchInput, matches: { hits: [hit, { ...hit, emplId: other.emplId }], confirmed: [hit, { ...hit, emplId: other.emplId }], dropped: [] }, state: "multiple-matches", code: "PERSON_LOOKUP_MATCH_MULTIPLE_MATCHES" },
  { id: "M5", input: { ...matchInput, crmCheck: true }, matches: { hits: [hit], confirmed: [hit], dropped: [] }, state: "found", crm: "Found" },
  { id: "F1", state: "failed", code: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED", ucpathFailure: true },
  { id: "F2", state: "active", code: "PERSON_LOOKUP_CRM_CHECK_FAILED", crm: "Check failed", crmFailure: true },
];
function personDetail(person: z.output<typeof UcpathCandidateSchema>): PersonOrgDetail {
  return { observedEid: person.emplId, displayedName: person.name, employmentInstances: "already-complete",
    startDate: person.startDate, terminationDate: person.terminationDate, terminationReason: person.terminationReason,
    cells: [[...assignmentDetailsToCells({ emplRecord: "0", effectiveDate: person.effectiveDate, hrStatus: person.hrStatus,
      businessUnit: "SDCMP", positionNumber: "40000000", deptId: "000412", department: person.department,
      jobCode: "004921", jobCodeDescription: person.jobTitle, expectedJobEndDate: "", fte: "0.50", emplClass: "Student" })]] };
}

function makeCase(testCase: Case) {
  const input = PersonLookupInput.parse(testCase.input ?? { emplId: candidate.emplId });
  const records = testCase.records ?? [record];
  const sessions = sessionFactoryHarness({
    ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(searchResult(testCase.candidates ?? [candidate])),
      async searchPersonOrg(request: z.output<typeof import("../../../src/models/systems/ucpath/search-person-org.js").SearchPersonOrgInputSchema>) {
        return searchPersonOrgWithPagePort({
          async search(query) {
            recordBrowserAction("opened", "ucpath.person-org.summary");
            recordBrowserAction("typed", "ucpath.person-org.criteria", query.kind === "by-eid" ? query.eid : `${query.lastName}, ${query.givenName}`);
            recordBrowserAction("clicked", "ucpath.person-org.search-button");
            if (testCase.ucpathFailure) throw new Error("UCPath unavailable");
            const people = query.kind === "by-eid" && testCase.recovered ? [candidate] : testCase.candidates ?? [candidate];
            if (people.length === 0) return { kind: "not-found", marker: "No matching values were found" };
            if (query.kind === "by-eid" && people.length === 1) return { kind: "detail", detail: personDetail(people[0]) };
            return { kind: "grid", rows: people.map((person, rowIndex) => ({ emplId: person.emplId, emplRecord: "0", hrStatus: person.hrStatus, businessUnit: "SDCMP", jobCode: "004921", jobCodeDescription: person.jobTitle, lastName: "Example", name: "Person", rowIndex })) };
          },
          async drill(rowIndex) {
            const person = (testCase.candidates ?? [candidate])[rowIndex];
            assert.ok(person);
            recordBrowserAction("clicked", "ucpath.person-org.open-record", person.emplId);
            return personDetail(person);
          },
          async returnToResults() { recordBrowserAction("clicked", "ucpath.person-org.return-results"); return (testCase.candidates ?? [candidate]).map((person, rowIndex) => ({ emplId: person.emplId, emplRecord: "0", hrStatus: person.hrStatus, businessUnit: "SDCMP", jobCode: "004921", jobCodeDescription: person.jobTitle, lastName: "Example", name: "Person", rowIndex })); },
        }, request);
      },
      async searchPersonMatch(criteria: z.output<typeof import("../../../src/models/systems/ucpath/search-person-match.js").SearchPersonMatch.input>) {
        const matches = SearchPersonMatchOutputSchema.parse(testCase.matches);
        return searchPersonMatchWithPort({
          async search() {
            recordBrowserAction("opened", "ucpath.match.search");
            recordBrowserAction("typed", "ucpath.match.criteria", "Example, Person; DOB 01/15/2000; SSN masked");
            recordBrowserAction("clicked", "ucpath.match.search");
            recordBrowserAction("read", "ucpath.match.results", JSON.stringify(matches.hits));
            return matches.hits;
          },
          async confirm(emplId) {
            recordBrowserAction("opened", "ucpath.match.person-org-confirmation", emplId);
            const confirmed = matches.confirmed.find((person) => person.emplId === emplId);
            const output = confirmed === undefined ? searchResult([{ ...candidate, emplId, name: "Different, Person" }]) : searchResult([{ ...candidate, emplId, name: confirmed.name }]);
            recordBrowserAction("read", "ucpath.match.confirmed-name", output.selection.selected?.name ?? "No Person Org record");
            return output;
          },
        }, criteria);
      },
    }),
    crm: () => ({ ...createDeterministicCrmOnboardingDriver({ discovery: records, record: { state: "found", record: { recordId: record.recordId, emplId: record.emplId, fullName: record.name, rawStage: "Completed" } },
      dates: ReadOnboardingDatesOutputSchema.parse({ emplId: candidate.emplId, state: "read", employmentDate: "2026-07-01", oathDate: "2026-06-25", reason: "" }) }),
      async verifyOnboardingRecord(request: z.output<typeof CrmDiscoveredRecordSchema>) {
        recordBrowserAction("opened", "crm.onboarding.record");
        if (testCase.reopenFailure) throw new Error("reopen unavailable");
        recordBrowserAction("read", "crm.onboarding.record", JSON.stringify(request));
        return request;
      },
      async searchOnboardingRecords(request: z.output<typeof import("../../../src/models/systems/crm/search-onboarding-records.js").CrmSearchOnboardingRecords.input>) {
        if (testCase.id === "M5") assert.deepEqual(request, { eid: candidate.emplId, name: candidate.name });
        recordBrowserAction("typed", "crm.onboarding.search-criteria", candidate.name);
        recordBrowserAction("clicked", "crm.onboarding.search");
        testCase.onCrmSearch?.();
        if (testCase.crmFailure) throw new Error("unavailable");
        recordBrowserAction("read", "crm.onboarding.record-count", String(records.length));
        return [...records];
      },
    }),
  });
  const harness = world.executorHarness({ sessions });
  const { database, clock } = harness.authority;
  const plan = planStart({ authority: database, clock, ids: sequentialIdFactory("f"), planTtlMs: 600000 }, {
    descriptor: personLookupDescriptor, submissions: [input], dryRun: false, priority: "bulk", shape: "single", plannedBy: "local-operator",
    configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
  });
  assert.equal(plan.refused.length, 0);
  const entry = plan.planned[0]; assert.ok(entry);
  const queued = buildQueuedRun({ descriptor: personLookupDescriptor, runId: "22222222-2222-4222-8222-222222222222", itemId: entry.itemId, traceId: "pl-090000-2222",
    rawInput: entry.rawInput, canonicalInput: entry.input, ingressSchemaHash: plan.ingressSchemaHash, configFingerprint: plan.configFingerprint, configSnapshotId: plan.configSnapshotId,
    resolvedInstance: plan.resolvedInstance, shape: plan.shape, priority: plan.priority, dryRun: false, attempt: 1, runNumber: 1, appVersion: "0.1.0", now: clock.now().toISOString() });
  return { harness, queued, input, plan };
}
function stepStatuses(harness: ReturnType<typeof world.executorHarness>) {
  const tasks = harness.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "task");
  return personLookupDescriptor.timeline.map((step) => {
    const outcomes = tasks.filter((event) => event.t === "span.ended" && event.kind === "task" && step.nodes.some((node) => event.spanPath.includes(`/${node.id}#`))).map((event) => event.t === "span.ended" ? event.outcome : "");
    return outcomes.includes("failed") ? "failed" : outcomes.includes("done") ? "completed" : outcomes.length > 0 && outcomes.every((outcome) => outcome === "skipped") ? "skipped" : "not-started";
  });
}
describe("approved Person Lookup scenarios", () => {
  for (const testCase of cases) it(testCase.id, async () => {
    const { harness, queued, input } = makeCase(testCase);
    const { database, clock } = harness.authority;
    const claimed = world.enqueueAndClaim(database, queued, clock.now().toISOString());
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const result = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: world.SIGNAL });
    assert.equal(result.state, testCase.state === "failed" ? "failed" : "done", database.authority.failures.listByRun(queued.envelope.runId).map((failure) => failure.summary).join("; "));
    const events = harness.emitter.events();
    const tasks = events.filter((event) => event.t === "span.ended" && event.kind === "task");
    assert.deepEqual(personLookupDescriptor.timeline.map((step) => step.label), ["Search for person", "Cross-check identity", "Read employment status", "Read CRM dates"]);
    const runEvents = JSON.stringify(database.authority.timelineEvents.page({}));
    assert.equal(runEvents.includes("123456789"), false);
    assert.equal(runEvents.includes("sign-in"), false);
    if (testCase.state === "failed") {
      assert.equal(database.authority.failures.listByRun(queued.envelope.runId)[0]?.code, testCase.code?.toUpperCase().replaceAll("-", "_"));
      assert.deepEqual(tasks.map(event => event.t === "span.ended" ? event.outcome : ""), ["failed"]);
      assert.equal(database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, queued.envelope.itemId).length, 0);
      const actions = database.authority.timelineEvents.page({}).flatMap(event => event.payload.kind === "note" && event.payload.note.action !== undefined ? [event.payload.note.action.targetId] : []);
      assert.deepEqual(actions, ["ucpath.person-org.summary", "ucpath.person-org.criteria", "ucpath.person-org.search-button"]);
      assert.ok(personLookupDescriptor.actions.enabled.includes("retry"));
      return;
    }
    const terminal = database.authority.runResults.get(queued.envelope.runId); assert.ok(terminal);
    const output = PersonLookupResultSchema.parse(terminal.result.value);
    const receiptRun = database.authority.runs.get(queued.envelope.runId); assert.ok(receiptRun);
    const actualReceipt = buildRunEvidenceReceipt({ descriptor: personLookupDescriptor, run: receiptRun, result: terminal,
      checkpoints: database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, queued.envelope.itemId) });
    const agreement = actualReceipt.verification.find(row => row.obligation === "identity.eid-agrees-across-sources");
    const selection = actualReceipt.verification.find(row => row.obligation === "identity.ucpath-selection-is-unambiguous");
    assert.ok(agreement); assert.ok(selection);
    const verifiedRecord = terminal.dependencies.find(row => row.nodeId === "crm-selected-record")?.state === "resolved";
    assert.equal(agreement.verdict === "verified", verifiedRecord);
    assert.equal(selection.verdict === "verified", output.activeStatus.ucpathSelection === "resolved");
    if (input.mode === "match") {
      const run = database.authority.runs.get(queued.envelope.runId); assert.ok(run);
      const receipt = buildRunEvidenceReceipt({ descriptor: personLookupDescriptor, run, result: terminal,
        checkpoints: database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, queued.envelope.itemId) });
      const ssn = receipt.input.find(fact => fact.field === "ssn"); assert.ok(ssn?.state === "satisfied");
      assert.equal(Object.hasOwn(ssn.value, "rawValue"), false);
      assert.equal(JSON.stringify(receipt).includes(matchInput.ssn), false);
      assert.equal(JSON.stringify(receipt).includes("6789"), false);
    }
    assert.equal(output.activeStatus.state, testCase.state);
    assert.equal(output.activeStatus.code, testCase.code ?? null);
    const ambiguous = testCase.state === "multiple-matches";
    const matchMode = input.mode === "match";
    const missing = ["not-found", "not-found-in-ucpath"].includes(testCase.state);
    const expectedPerson = testCase.recovered ? candidate : testCase.candidates?.[0] ?? candidate;
    const resolved = !ambiguous && !missing;
    const expectedCrm = testCase.crm ?? (matchMode ? "Not checked" : ambiguous ? "Not found" : missing ? "Not found" : "Found");
    assert.deepEqual(output.activeStatus.details, {
      search: matchMode ? "Example, Person, 01/15/2000, [masked]" : "emplId" in input ? candidate.emplId : candidate.name,
      name: resolved ? candidate.name : null, eid: resolved ? candidate.emplId : null,
      department: resolved ? matchMode ? expectedCrm === "Found" ? record.department : null : testCase.state === "crm-only" ? record.department : expectedPerson.department : null,
      hrStatus: resolved && !matchMode && testCase.state !== "crm-only" ? expectedPerson.hrStatus : null,
      ucpath: matchMode ? missing ? "Not found" : "Found" : ["S4", "S5", "S10", "S11", "S12"].includes(testCase.id) ? "Not found" : "Found",
      crm: expectedCrm, startDate: resolved && expectedCrm === "Found" ? record.firstDayOfService : null,
      endDate: testCase.id === "S2" ? "09/01/2026" : null, terminationReason: testCase.id === "S2" ? "Resigned" : null,
      foundInUcpath: matchMode ? !missing : null, matchedEid: matchMode && resolved ? candidate.emplId : null, matchedName: matchMode && resolved ? candidate.name : null,
    });
    if (testCase.crm !== undefined) assert.equal(output.activeStatus.details.crm, testCase.crm);
    if (testCase.state === "multiple-matches") { assert.equal(output.activeStatus.details.eid, null); assert.deepEqual(output.activeStatus.candidateEids, [candidate.emplId, other.emplId]); }
    if (testCase.id === "S2") { assert.equal(output.activeStatus.details.endDate, "09/01/2026"); assert.equal(output.activeStatus.details.terminationReason, "Resigned"); }
    if (testCase.id === "S3") {
      assert.equal(output.activeStatus.hdh, false);
      const employment = database.authority.timelineEvents.page({}).find(event => event.payload.kind === "note" && event.payload.note.message === "Employment status");
      assert.ok(employment?.payload.kind === "note");
      assert.ok(employment.payload.note.spanPath.includes("/active-status#1"));
      assert.ok(employment.payload.note.fields?.some(field => field.key === "HDH department" && field.value === "No"));
      assert.ok(employment.payload.note.fields?.some(field => field.key === "department" && field.value === "Engineering"));
    }
    if (testCase.id === "S14") assert.equal(output.activeStatus.reason, "UCPath HR status is unreadable: Unreadable");
    if (testCase.id === "S15") { assert.equal(harness.sessions.opens("crm"), 0); assert.equal(output.activeStatus.details.startDate, null); }
    if (testCase.dates) { assert.ok(output.crmDates.state === "included"); assert.equal(output.crmDates.dates.employmentDate, "2026-07-01"); assert.equal(output.crmDates.dates.oathDate, "2026-06-25"); }
    const endedIds = tasks.map((event) => event.t === "span.ended" && event.kind === "task" ? event.spanPath.split("/").at(-1)!.split("#")[0] : "");
    const order = personLookupDescriptor.nodes.map((node) => String(node.id));
    assert.deepEqual(endedIds, [...endedIds].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    const statuses = stepStatuses(harness);
    assert.deepEqual(statuses, ["completed", input.crmCheck && (!matchMode || testCase.state === "found") ? "completed" : "skipped", matchMode ? "skipped" : "completed", testCase.dates ? "completed" : "skipped"]);
    const actions = database.authority.timelineEvents.page({}).flatMap((event) => event.payload.kind === "note" && event.payload.note.action !== undefined ? [event.payload.note.action] : []);
    const searchActions = ["ucpath.person-org.summary", "ucpath.person-org.criteria", "ucpath.person-org.search-button"];
    const byName = input.mode === "search" && !("emplId" in input);
    const people = testCase.candidates ?? [candidate];
    const expectedActions = matchMode ? ["ucpath.match.search", "ucpath.match.criteria", "ucpath.match.search", "ucpath.match.results", "ucpath.match.last-name-check",
      ...(testCase.matches?.hits ?? []).flatMap(() => ["ucpath.match.person-org-confirmation", "ucpath.match.confirmed-name"]),
      ...((testCase.matches?.hits.length ?? 0) > 0 ? ["ucpath.match.search", "ucpath.match.criteria", "ucpath.match.search", "ucpath.match.results"] : []), "ucpath.match.result"]
      : [...(byName ? ["ucpath.person-org.search-attempt"] : []), ...searchActions,
        ...(byName ? ["ucpath.person-org.search-results", ...people.flatMap(() => ["ucpath.person-org.open-record", "ucpath.person-org.candidate", "ucpath.person-org.return-results"])] : []),
        ...(byName ? ["ucpath.person-org.department-filter"] : people.length > 0 ? ["ucpath.person-org.employment-instances"] : []),
        ...(people.length > 0 && !["S7", "S8", "S13"].includes(testCase.id) ? ["ucpath.person-org.person", ...(byName ? ["ucpath.person-org.open-record"] : [])] : [])];
    if (input.crmCheck && (!matchMode || testCase.state === "found")) expectedActions.push("crm.onboarding.search-criteria", "crm.onboarding.search", ...(!testCase.crmFailure ? ["crm.onboarding.record-count"] : []));
    if (expectedCrm === "Found") expectedActions.push("crm.onboarding.record", "crm.onboarding.record");
    if (["S5", "S8", "S11", "S12"].includes(testCase.id)) expectedActions.push("crm.onboarding.search-criteria", "crm.onboarding.search", "crm.onboarding.record-count");
    if (["S4", "S9", "S10", "S13"].includes(testCase.id)) expectedActions.push(...searchActions, ...(["S9", "S13"].includes(testCase.id) ? ["ucpath.person-org.employment-instances", "ucpath.person-org.person"] : []));
    assert.deepEqual(actions.map(action => action.targetId), expectedActions);
    assert.ok(actions.length > 0);
    const systems = actions.map((action) => action.targetId.split(".")[0]);
    const firstCrm = systems.indexOf("crm");
    if (firstCrm >= 0) assert.ok(systems.slice(0, firstCrm).every((system) => system === "ucpath"));
    if (matchMode) {
      const surnameCheck = actions.findIndex((action) => action.targetId === "ucpath.match.last-name-check");
      const confirmation = actions.findIndex((action) => action.targetId === "ucpath.match.person-org-confirmation");
      if (confirmation >= 0) assert.ok(surnameCheck >= 0 && surnameCheck < confirmation);
      assert.ok(actions.some((action) => action.targetId === "ucpath.match.result"));
    }

  });
  it("preserves CRM person identity with conflicting forms and requested dates", async () => {
    const { harness, queued } = makeCase({ id: "multi-form", state: "crm-only", candidates: [], input: { name: candidate.name, includeCrmDates: true },
      records: [record, { ...record, recordId: "ONB-2", name: "Different, Person", firstDayOfService: "07/02/2026" }] });
    const { database, clock } = harness.authority;
    const claimed = world.enqueueAndClaim(database, queued, clock.now().toISOString());
    assert.equal((await executeClaimedRun(harness.deps, { ...claimed, signal: world.SIGNAL })).state, "done");
    const terminal = database.authority.runResults.get(queued.envelope.runId); assert.ok(terminal);
    const output = PersonLookupResultSchema.parse(terminal.result.value);
    assert.equal(output.activeStatus.details.crm, "Found"); assert.equal(output.activeStatus.details.eid, candidate.emplId);
    assert.equal(output.activeStatus.details.name, null); assert.equal(output.activeStatus.details.startDate, null);
    assert.ok(output.crmDates.state === "included"); assert.equal(output.crmDates.dates.state, "no-confident-record");
    assert.equal(terminal.dependencies.find(row => row.nodeId === "crm-selected-record")?.state, "not-run");
  });
  for (const failed of [false, true]) it(`persists actual ${failed ? "failure" : "success"} lease screenshot artifacts`, async () => {
    const { harness, queued } = makeCase({ id: "capture", state: failed ? "failed" : "active", ucpathFailure: failed });
    const { database, clock, profile } = harness.authority;
    const writer = createContentAddressedArtifactWriter({ admission: profile.admission });
    await writer.ready;
    const service = createDiagnosticCaptureService({ artifacts: writer, authority: database.authority, clock, ids: sequentialIdFactory("d") });
    const factory = { ...harness.sessions.factory, async open(input: Parameters<typeof harness.sessions.factory.open>[0]) {
      const resource = await harness.sessions.factory.open(input);
      return { ...resource, reset: async (options: Parameters<typeof resource.reset>[0]) => {
        assert.ok(database.authority.diagnosticBundles.listByRun(queued.envelope.runId).length > 0, "capture persists before reset");
        return resource.reset(options);
      }, screenshot: async () => ({ pageVersion: 1, sessionId: resource.sessionId, observedAt: clock.now().toISOString(), state: "available" as const, bytes: Buffer.from([137,80,78,71]), width: 1, height: 1 }) };
    } };
    const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse("person-lookup-worker-1"), workflowId: personLookupDescriptor.id, stores: harness.deps.stores,
      factory, clock, scheduler: harness.scheduler, acquireDeadlineMs: 60000,
      duoCeremony: (await import("../../support/helpers/duo-ceremony-fixtures.js")).fixtureDuoCeremonyGates(clock), browserScreenshotCapture: createRunBrowserScreenshotCapture({ service }) });
    sessions.bindRunConfigFingerprint(FingerprintSchema.parse(CONFIG_SNAPSHOT.fingerprint), "headless", { runId: queued.envelope.runId, descriptorFingerprint: personLookupDescriptor.contractFingerprint, captureBrowserScreenshots: !failed });
    const claimed = world.enqueueAndClaim(database, { ...queued, envelope: { ...queued.envelope, captureBrowserScreenshots: !failed } }, clock.now().toISOString());
    assert.equal((await executeClaimedRun({ ...harness.deps, sessions, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 }) }, { ...claimed, signal: world.SIGNAL })).state, failed ? "failed" : "done");
    const actions = database.authority.timelineEvents.page({}).flatMap(event => event.payload.kind === "note" && event.payload.note.action?.kind === "screenshot" ? [event.payload.note.action] : []);
    assert.ok(actions.length > 0);
    const timeline = database.authority.timelineEvents.page({});
    for (const row of timeline) {
      if (row.payload.kind !== "note" || row.payload.note.action?.kind !== "screenshot") continue;
      const note = row.payload.note;
      assert.match(note.spanPath, /\/(searching|cross-verify|crm-selected-record)#1/u);
      const endIndex = timeline.findIndex(event => event.payload.kind === "span"
        && event.payload.event.t === "span.ended" && event.payload.event.spanPath === note.spanPath);
      assert.ok(endIndex > timeline.indexOf(row), "capture note persists before its task ends");
    }
    for (const action of actions) {
      assert.equal(typeof action.value, "string");
      const association = typeof action.value === "string" ? action.value.split(":") : undefined; assert.equal(association?.length, 2);
      const bundle = database.authority.diagnosticBundles.get(association?.[0] ?? ""); assert.ok(bundle);
      assert.equal(bundle.runId, queued.envelope.runId);
      assert.ok(bundle.attachments.some(row => row.artifactId === association?.[1] && row.kind === "screenshot"));
    }
    if (failed) assert.equal(actions.length, 1);
  });
  it("M4", () => {
    assert.throws(() => parsePersonLookupRequest("Example, Person, x, X", { mode: "match" }), (error: unknown) => error instanceof PersonLookupMatchInputError && error.code === "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS");
    assert.equal(PersonLookupInput.safeParse({ mode: "match", lastName: "Example", firstName: "Person", dob: "x" }).success, false);
  });
  it("F3", async () => {
    for (const system of ["ucpath", "crm", "duo"] as const) {
    const { harness, queued } = makeCase({ id: "F3", state: "failed" });
    const factory = { ...harness.sessions.factory, async open(input: Parameters<typeof harness.sessions.factory.open>[0]) {
      const resource = await harness.sessions.factory.open(input);
      if (input.system !== (system === "crm" ? "crm" : "ucpath")) return resource;
      return { ...resource, authentication: { authenticate: async () => { recordBrowserAction("session", `${input.system}.login`); if (system === "duo") throw new DuoTerminalRefusalError("ucpath", "synthetic rejection", "https://example.invalid/login"); throw new BrowserLoginError(input.system, "sso-submit", "synthetic rejection", "https://example.invalid/login"); } } };
    } };
    const events: unknown[] = [];
    const sessions = new (await import("../../../src/backend/runtime/workers/worker-sessions.js")).WorkerSessionManager({
      workerId: WorkerIdSchema.parse("person-lookup-worker-1"), workflowId: WorkflowIdSchema.parse("person-lookup"), stores: harness.deps.stores, factory, clock: harness.authority.clock, scheduler: harness.scheduler,
      acquireDeadlineMs: 60000, duoCeremony: (await import("../../support/helpers/duo-ceremony-fixtures.js")).fixtureDuoCeremonyGates(harness.authority.clock), onEvent: (event) => { events.push(event); },
    });
    sessions.bindRunConfigFingerprint(FingerprintSchema.parse(CONFIG_SNAPSHOT.fingerprint));
    const { database, clock } = harness.authority;
    const claimed = world.enqueueAndClaim(database, queued, clock.now().toISOString());
    assert.equal((await executeClaimedRun({ ...harness.deps, sessions, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 }) }, { ...claimed, signal: world.SIGNAL })).state, "failed");
    assert.equal(database.authority.failures.listByRun(queued.envelope.runId)[0]?.code, system === "crm" ? "CRM_SIGN_IN_FAILED" : system === "duo" ? "DUO_TERMINAL_REFUSAL" : "UCPATH_SIGN_IN_FAILED", JSON.stringify(database.authority.failures.listByRun(queued.envelope.runId)));
    assert.ok(events.length > 0);
    assert.equal(JSON.stringify(database.authority.timelineEvents.page({}).filter(event => event.payload.kind === "note")).includes(".login"), false);
    assert.ok(events.some(event => typeof event === "object" && event !== null && "reason" in event && event.reason === "login-failed"));
    assert.deepEqual(stepStatuses(harness), system === "crm" ? ["completed", "failed", "not-started", "not-started"] : ["failed", "not-started", "not-started", "not-started"]);
    if (system !== "crm") assert.equal(database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, queued.envelope.itemId).length, 0);
    }
  });
  it("F4", async () => {
    const { harness, queued } = makeCase({ id: "F4", state: "cancelled" });
    const { database, clock } = harness.authority;
    const claimed = world.enqueueAndClaim(database, queued, clock.now().toISOString());
    assert.equal(testRunService(database, clock).transition({
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: queued.envelope.runId, expectedVersion: claimed.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() },
    }).state, "applied");
    await executeClaimedRun(harness.deps, { ...claimed, signal: world.SIGNAL });
    assert.equal(database.authority.runs.get(queued.envelope.runId)?.lifecycle.state, "terminal");
    assert.equal(harness.sessions.opens(), 0);
    assert.equal(database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, queued.envelope.itemId).length, 0);
    assert.deepEqual(stepStatuses(harness), ["not-started", "not-started", "not-started", "not-started"]);
    const running = makeCase({ id: "F4-midrun", state: "cancelled", onCrmSearch: () => {
      const run = running.harness.authority.database.authority.runs.get(running.queued.envelope.runId); assert.ok(run);
      assert.equal(testRunService(running.harness.authority.database, running.harness.authority.clock).transition({ commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", runId: run.envelope.runId, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }).state, "applied");
    } });
    const midClaim = world.enqueueAndClaim(running.harness.authority.database, running.queued, clock.now().toISOString());
    assert.equal((await executeClaimedRun(running.harness.deps, { ...midClaim, signal: world.SIGNAL })).state, "abandoned");
    const checkpoints = running.harness.authority.database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, midClaim.run.envelope.itemId);
    assert.ok(checkpoints.some(checkpoint => checkpoint.nodeId === "searching"));
    assert.equal(checkpoints.some(checkpoint => checkpoint.nodeId === "active-status"), false);
    assert.deepEqual(stepStatuses(running.harness), ["completed", "completed", "not-started", "not-started"]);
    const cancelled = running.harness.authority.database.authority.runs.get(midClaim.run.envelope.runId); assert.ok(cancelled);
    assert.ok(cancelled.lifecycle.state === "terminal"); assert.equal(cancelled.lifecycle.outcome, "cancelled");

  });
  it("F5", async () => {
    const { harness, queued, input, plan } = makeCase({ id: "F5", state: "active" });
    const { database, clock } = harness.authority;
    const claimed = world.enqueueAndClaim(database, queued, clock.now().toISOString());
    assert.equal((await executeClaimedRun(harness.deps, { ...claimed, signal: world.SIGNAL })).state, "done");
    const source = database.authority.runs.get(queued.envelope.runId); assert.ok(source);
    const before = JSON.stringify(source);
    const beforeResult = JSON.stringify(database.authority.runResults.get(source.envelope.runId));
    const beforeCheckpoints = JSON.stringify(database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, source.envelope.itemId));
    const rerun = buildRerunPlan(database.authority, personLookupDescriptor, { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys: personLookupDescriptor.timeline.map((step) => step.key) }, plan.planned);
    const runtimeConfig = database.authority.runtimeConfig.get(); assert.ok(runtimeConfig);
    const service = new RunRecordService({ database, clock, ids: sequentialIdFactory("c"), publishQueued: () => undefined });
    const admitted = service.restart({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId: source.envelope.runId, expectedVersion: source.version,
      runtimeConfig: { generation: runtimeConfig.generation, settingsRevision: runtimeConfig.settingsRevision, settingsFingerprint: runtimeConfig.settingsFingerprint, configFingerprint: runtimeConfig.configFingerprint } }, personLookupDescriptor);
    assert.ok(admitted.state === "applied", JSON.stringify(admitted));
    const next = database.authority.runs.get(admitted.run.envelope.runId); assert.ok(next);
    assert.equal(rerun.source.runId, source.envelope.runId);
    assert.notEqual(next.envelope.runId, source.envelope.runId);
    assert.equal(next.envelope.retryOf, source.envelope.runId);
    assert.deepEqual(next.input.parsed.value, source.input.parsed.value);
    assert.deepEqual(next.input.parsed.value, input);
    const nextClaim = database.authority.runs.claimNext({ workflow: personLookupDescriptor.id, workerId: claimed.claim.workerId, now: clock.now().toISOString() });
    assert.ok(nextClaim.state === "claimed", JSON.stringify(nextClaim));
    assert.equal(nextClaim.run.envelope.runId, next.envelope.runId);
    assert.equal((await executeClaimedRun(harness.deps, { run: nextClaim.run, claim: { workerId: claimed.claim.workerId, claimGeneration: nextClaim.run.claimGeneration }, signal: world.SIGNAL })).state, "done");
    assert.deepEqual(database.authority.runResults.get(next.envelope.runId)?.result.value, database.authority.runResults.get(source.envelope.runId)?.result.value);
    assert.equal(JSON.stringify(database.authority.runs.get(source.envelope.runId)), before);
    assert.equal(JSON.stringify(database.authority.runResults.get(source.envelope.runId)), beforeResult);
    assert.equal(JSON.stringify(database.authority.runCheckpoints.listByItem(personLookupDescriptor.id, source.envelope.itemId).filter(checkpoint => checkpoint.runId === source.envelope.runId)), beforeCheckpoints);
  });
});
