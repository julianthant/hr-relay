import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { dataOriginViewsOf } from "../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { stepProofModuleOf } from "../../../src/backend/app/registries/step-proof-modules.js";
import { buildRunGate } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { projectObservedOperatorFields } from "../../../src/backend/runs/queries/run-logs.js";
import { referenceCheckStop } from "../../../src/models/processing/workbooks/reference-check-stop.js";
import { SeparationsReadReferenceStop } from "../../../src/models/workflows/separations/read-reference-stop.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import type { SearchPersonOrgOutput } from "../../../src/models/systems/ucpath/search-person-org.js";
import { projectFailureForOperator } from "../../../src/models/trust/failure.js";
import { separationsWorkflow } from "../../../src/workflows/separations/workflow.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { createReferenceCheckWriteWorld } from "../../support/helpers/backend/reference-check-write-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { registeredModule, separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../../src/backend/systems/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { createDeterministicUcpathSmartHrWorldDriver, createUcpathSmartHrFakeWorld } from "../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { UCPATH_PERSON_ORG_DETAIL_READY, UCPATH_PERSON_ORG_DETAIL_SCREEN, UCPATH_PERSON_ORG_DISPLAYED_EID, UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN } from "../../../src/models/ui/ucpath-person-org.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FINALIZATION_JOB_SUMMARY_READ, FINALIZATION_NAME_SEARCH_OUTPUT } from "../../support/helpers/kuali-finalization-fixtures.js";
import { KUALI_SEPARATION_FORM_TYPE } from "../../../src/models/ui/kuali-separation-document.js";
import { COMPOSITION_ACTION_ID, COMPOSITION_DOCUMENT_NAME, COMPOSITION_LAST_DAY_WORKED, COMPOSITION_SEPARATION_DATE, COMPOSITION_DOCUMENT, COMPOSITION_EID, COMPOSITION_NOW, COMPOSITION_RECEIPT,
  COMPOSITION_UCPATH_NAME } from "../../support/helpers/separations-composition-fixtures.js";

const ReferenceCheckStopInput = SeparationsReadReferenceStop.input;
const world = createReferenceCheckWriteWorld();
afterEach(world.cleanup);
const proof = stepProofModuleOf("separations-reference-check");
assert.ok(proof);
const { descriptor } = proof;
const INPUT = { emplId: "10000001", employeeName: "Lee, Jordan" };
/** A name the approved subject never carries, so finding it anywhere in the run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";
const nodes = descriptorRuntimeNodes(separationsDescriptor);
const node = (id: string) => { const found = nodes.find(candidate => String(candidate.id) === id); assert.ok(found, id); return found; };
/** Every node `id` waits for, directly or through another node. */
function upstreamOf(id: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (next: string) => { for (const dependency of node(next).dependsOn.map(String)) if (!seen.has(dependency)) { seen.add(dependency); visit(dependency); } };
  visit(id);
  return seen;
}

async function fixture() {
  const f = await world.fixture(descriptor, sessionFactoryHarness({}));
  const holding = () => f.spreadsheet("Separations roster", "People", ["eid", "fullName"], [["10000009", "Blair Example"], [INPUT.emplId, "Jordan Lee"]]);
  const missing = () => f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]]);
  const renamed = () => f.spreadsheet("Separations roster", "People", ["fullName", "eid"], [[ROW_ONLY_NAME, INPUT.emplId]]);
  const card = (run: RunRecord) => {
    const parked = f.current(run);
    const gate = GateDecisionWireSchema.parse(buildRunGate(f.gateDeps, parked.envelope.runId, undefined, parked));
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    return gate.decision;
  };
  return { ...f, holding, missing, renamed, card };
}

describe("Separations reference spreadsheet check", () => {
  it("checks the approved person after the identity check, and every write waits for the review", () => {
    const keys = separationsDescriptor.timeline.map(step => step.key);
    assert.ok(keys.indexOf("reference-check") > keys.indexOf("identity-check"));
    assert.ok(keys.indexOf("reference-check") < keys.indexOf("ucpath-transaction"));
    assert.deepEqual(node("reference-check").dependsOn.map(String), ["approval"]);
    const review = node("reference-check-review");
    assert.ok(review.kind === "gate" && review.resolvedBy === "operator");
    assert.deepEqual(review.when, { kind: "is-present", of: { from: "node", nodeId: "reference-stop", path: "ask" } });
    for (const write of nodes.filter(candidate => candidate.kind === "transaction")) {
      assert.ok(upstreamOf(String(write.id)).has("reference-check-review"), `${String(write.id)} waits for the reference review`);
    }
    assert.deepEqual(nodes.filter(candidate => candidate.kind === "transaction" && !upstreamOf(String(candidate.id)).has("reference-check-review")), []);
    assert.equal(upstreamOf("reference-check-review").has("clear-pending"), false, "the review comes before the first write");
  });

  it("skips the check with no spreadsheet picked and asks nothing", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, []));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.nodeSpans(run, "reference-check"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.checkLines(run), []);
  });

  it("separations/reference-check — goes on without asking when the picked spreadsheet holds the person", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, [f.holding()]));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.checkLines(run), ["Separations roster · People: found in row 3"]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
  });

  it("separations-reference-check/reference-check — stops when the person is missing, and Continue anyway goes on", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.missing()]);
    const parked = await f.execute(started);
    assert.ok(parked.lifecycle.state === "parked-gate" && String(parked.lifecycle.gateId) === "reference-check-review");
    const decision = f.card(started);
    assert.equal(decision.type, "review-before-write");
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, "Badge list · Issued: not found · Compared: Employee ID, and name where the sheet has one.");
    assert.equal(f.continueAnyway(started).state, "applied");
    const done = await f.execute(started);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done");
  });

  it("stops with the same card when the name differs, without recording any value from the row, and Cancel run ends it", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.renamed()]);
    assert.equal((await f.execute(started)).lifecycle.state, "parked-gate");
    assert.equal(f.card(started).context, "Separations roster · People: name differs in row 2 · Compared: Employee ID, and name where the sheet has one.");
    assert.equal(JSON.stringify([f.events(started), f.card(started)]).includes(ROW_ONLY_NAME), false);
    assert.equal(f.cancel(started).state, "applied");
    const cancelled = f.current(started);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  });

  it("never stops a dry run: the proof refuses one, and the composition's stop reads a dry run as not writing", async () => {
    const f = await fixture();
    assert.throws(() => f.start(INPUT, [f.missing()], true), /dry-run-unsupported/u);
    const stop = node("reference-stop");
    assert.ok(stop.kind === "task");
    const check = { state: "checked", result: "unconfirmed", checks: [{ spreadsheet: "Badge list", sheet: "Issued", outcome: "not-found", row: null, line: "Badge list · Issued: not found" }] };
    const scope = (dryRun: unknown) => ({ input: {}, outputs: { "reference-check": check }, ...(dryRun === undefined ? {} : { dryRun }) }) as unknown as Parameters<typeof stop.bind>[0];
    assert.deepEqual(referenceCheckStop(ReferenceCheckStopInput.parse(stop.bind(scope({ mode: "preview" })))), { ask: null });
    assert.deepEqual(referenceCheckStop(ReferenceCheckStopInput.parse(stop.bind(scope(undefined)))), { ask: true });
  });
});

describe("Separations composition with a reference spreadsheet", () => {
  const REFERENCE_GATE = "reference-check-review";
  const OMIT_KRONOS = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/12/2026", separationDate: "06/19/2026" } }];

  async function composition(options: Readonly<{ documentEid?: string; searchOutput?: SearchPersonOrgOutput }> = {}) {
    const clock = manualClock(new Date(COMPOSITION_NOW));
    const kuali = createKualiFakeWorld({ actionId: COMPOSITION_ACTION_ID, documentNumber: COMPOSITION_DOCUMENT, displayedEid: COMPOSITION_EID });
    kuali.separationForm = { formType: KUALI_SEPARATION_FORM_TYPE, employeeName: COMPOSITION_DOCUMENT_NAME, eid: options.documentEid ?? COMPOSITION_EID, employeeType: "Student",
      studentTitleCode: "4921 - STDT 2", division: "Campus Dining and Retail", location: "Synthetic Hall", terminationType: "Move out of Area",
      lastDayWorked: COMPOSITION_LAST_DAY_WORKED, separationDate: COMPOSITION_SEPARATION_DATE, additionalComments: "", requestAcknowledged: false,
      timekeeperName: "", timekeeperComments: "", terminationEffectiveDate: "", department: "- - -", payrollTitleCode: "", payrollTitle: "",
      submittedTerminationTemplate: false, transactionNumber: "", finalPay: null };
    const ucpath = createUcpathSmartHrFakeWorld({ emplId: COMPOSITION_EID, displayedName: COMPOSITION_UCPATH_NAME, nextTransactionId: COMPOSITION_RECEIPT });
    const searches: Parameters<ReturnType<typeof createDeterministicUcpathPersonOrgDriver>["searchPersonOrg"]>[0][] = [];
    const sessions = sessionFactoryHarness({
      kuali: () => createDeterministicKualiDriver(kuali, clock),
      ucpath: () => {
        const person = createDeterministicUcpathPersonOrgDriver(options.searchOutput ?? FINALIZATION_NAME_SEARCH_OUTPUT, FINALIZATION_JOB_SUMMARY_READ);
        const filing = createDeterministicUcpathSmartHrWorldDriver(ucpath, () => clock.now());
        const personScreens: readonly unknown[] = [UCPATH_PERSON_ORG_SEARCH_SCREEN, UCPATH_PERSON_ORG_DETAIL_SCREEN];
        const personStates: readonly unknown[] = [UCPATH_PERSON_ORG_SEARCH_READY, UCPATH_PERSON_ORG_DETAIL_READY];
        // The person-org fake owns the search screens; the Smart HR world owns the transaction pages.
        return { ...person, scanTerminationTransactions: filing.scanTerminationTransactions, stageTermination: filing.stageTermination,
          stagePendingTerminationSweep: filing.stagePendingTerminationSweep, commit: filing.commit,
          searchPersonOrg: (input: typeof searches[number]) => {
            searches.push(input);
            return person.searchPersonOrg(input);
          },
          goto: (next: never) => personScreens.includes(next) ? person.goto(next) : filing.goto(next),
          waitFor: (stateId: never) => personStates.includes(stateId) ? person.waitFor(stateId) : filing.waitFor(stateId),
          read: (id: never) => id === UCPATH_PERSON_ORG_DISPLAYED_EID ? person.read(id) : filing.read(id) };
      },
    });
    const f = await world.fixture(separationsDescriptor, sessions);
    const commits = () => [...kuali.events, ...ucpath.events].filter(event => event.startsWith("commit:"));
    const begin = (picks: Parameters<typeof f.start>[1], dryRun = false) => f.start({ documentNumber: COMPOSITION_DOCUMENT }, picks, dryRun, { stepOmissions: OMIT_KRONOS,
      selectedStepKeys: separationsDescriptor.timeline.map(step => step.key).filter(key => key !== "kronos-timecard") });
    const writeIntents = (run: RunRecord) => f.database.authority.writeIntents.listByRun(run.envelope.runId);
    const holding = () => f.spreadsheet("Separations roster", "People", ["eid", "fullName"], [["10000009", "Blair Example"], [COMPOSITION_EID, COMPOSITION_UCPATH_NAME]]);
    const missing = () => f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]]);
    const renamed = () => f.spreadsheet("Separations roster", "People", ["fullName", "eid"], [[ROW_ONLY_NAME, COMPOSITION_EID]]);
    const parkedAt = (run: RunRecord) => run.lifecycle.state === "parked-gate" ? String(run.lifecycle.gateId) : run.lifecycle.state;
    return { ...f, commits, begin, writeIntents, holding, missing, renamed, parkedAt, searches };
  }

  it("stops before searching UCPath when the Kuali document has no Employee ID", async () => {
    const c = await composition({ documentEid: "" });
    const run = await c.execute(c.begin([], true));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const [failure] = c.database.authority.failures.listByRun(run.envelope.runId);
    assert.equal(failure?.nodeId, "subject");
    assert.equal(failure.code, "EMPLOYEE_ID_ABSENT");
    assert.match(failure.summary, /Kuali document 4444.*Employee ID/u);
    assert.match(projectFailureForOperator(failure, true).summary, /document does not show an Employee ID/iu);
    assert.deepEqual(c.searches, []);
    assert.deepEqual(c.nodeSpans(run, "job-summary"), []);
    assert.deepEqual(c.writeIntents(run), []);
  });

  it("stops before Job Summary when UCPath finds no exact Employee ID match", async () => {
    const c = await composition({ documentEid: COMPOSITION_EID, searchOutput: {
      results: [],
      selection: { status: "not-found", selected: null, candidateEids: [], searchName: COMPOSITION_EID },
    } });
    const run = await c.execute(c.begin([], true));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const [failure] = c.database.authority.failures.listByRun(run.envelope.runId);
    assert.equal(failure?.nodeId, "subject");
    assert.equal(failure.code, "EMPLOYEE_ID_NO_MATCH");
    assert.match(failure.summary, /No UCPath person matched Employee ID ••••0000/u);
    const card = projectFailureForOperator(failure, true);
    assert.match(card.summary, /No UCPath person matched the Employee ID on the separation document/iu);
    assert.ok(!JSON.stringify(card).includes(COMPOSITION_EID));
    assert.deepEqual(c.searches, [{ kind: "by-eid", emplId: COMPOSITION_EID }]);
    assert.deepEqual(c.nodeSpans(run, "job-summary"), []);
    assert.deepEqual(c.writeIntents(run), []);
    const origins = dataOriginViewsOf(registeredModule(separationsWorkflow));
    const searchedValues = c.events(run).flatMap(({ payload }) => {
      if (payload.kind !== "span" || payload.event.t !== "data.observed") return [];
      const event = payload.event;
      const origin = origins.find(candidate => candidate.nodeId === event.nodeId && candidate.taskId === event.taskId);
      return projectObservedOperatorFields(event, origin?.operatorFields)
        .filter(field => field.label === "Searched Employee ID").map(field => field.value);
    });
    assert.deepEqual(searchedValues, [COMPOSITION_EID]);
  });

  it("parks before any write when the person is missing, and Continue anyway files each write once", async () => {
    const c = await composition(), started = c.begin([c.missing()]);
    let run = await c.execute(started);
    assert.equal(c.parkedAt(run), REFERENCE_GATE);
    assert.deepEqual(c.commits(), []);
    assert.deepEqual(c.writeIntents(started), []);
    assert.equal(c.continueAnyway(started).state, "applied");
    run = await c.execute(started);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", c.parkedAt(run));
    assert.deepEqual(c.commits(), ["commit:kuali.rrss-document.save-button", "commit:ucpath.smart-hr.save-and-submit-button"]);
    assert.ok(c.writeIntents(started).length > 0);
  });

  it("parks on a name difference, and Cancel run ends it with no write", async () => {
    const c = await composition(), started = c.begin([c.renamed()]);
    assert.equal(c.parkedAt(await c.execute(started)), REFERENCE_GATE);
    assert.equal(c.cancel(started).state, "applied");
    const cancelled = c.current(started);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
    assert.deepEqual(c.commits(), []);
    assert.deepEqual(c.writeIntents(started), []);
  });

  it("never parks a dry run with the person missing, and records the check line", async () => {
    const c = await composition(), run = await c.execute(c.begin([c.missing()], true));
    assert.notEqual(c.parkedAt(run), REFERENCE_GATE);
    assert.deepEqual(c.nodeSpans(run, REFERENCE_GATE), [["skipped", "condition-false"]]);
    assert.deepEqual(c.checkLines(run), ["Badge list · Issued: not found"]);
    assert.deepEqual(c.commits(), []);
  });

  it("resumes from stored state after Continue anyway without asking again", async () => {
    const c = await composition(), started = c.begin([c.missing()]);
    assert.equal(c.parkedAt(await c.execute(started)), REFERENCE_GATE);
    assert.equal(c.continueAnyway(started).state, "applied");
    const resumed = await c.execute(c.current(started));
    assert.ok(resumed.lifecycle.state === "terminal" && resumed.lifecycle.outcome === "done", c.parkedAt(resumed));
    assert.equal(c.database.authority.gateResults.listByRun(started.envelope.runId).filter(result => String(result.gateId) === REFERENCE_GATE).length, 1);
    assert.deepEqual(c.commits(), ["commit:kuali.rrss-document.save-button", "commit:ucpath.smart-hr.save-and-submit-button"]);
  });

  it("does not park at the reference review when the picked spreadsheet holds the person", async () => {
    const c = await composition(), run = await c.execute(c.begin([c.holding()]));
    assert.notEqual(c.parkedAt(run), REFERENCE_GATE);
    assert.deepEqual(c.nodeSpans(run, REFERENCE_GATE), [["skipped", "condition-false"]]);
    assert.deepEqual(c.checkLines(run), ["Separations roster · People: found in row 3"]);
  });

  it("resumes past a skipped identity approval when the document carries the Employee ID and the Kronos timecard is omitted", async () => {
    const c = await composition({ documentEid: COMPOSITION_EID }), started = c.begin([c.missing()]);
    const parked = await c.execute(started);
    assert.equal(c.parkedAt(parked), REFERENCE_GATE);
    assert.deepEqual(c.searches, [{ kind: "by-eid", emplId: COMPOSITION_EID }]);
    assert.deepEqual(c.nodeSpans(parked, "identity-approval"), [["skipped", "condition-false"]]);
    assert.equal(c.continueAnyway(started).state, "applied");
    const resumed = await c.execute(c.current(started));
    assert.ok(resumed.lifecycle.state === "terminal" && resumed.lifecycle.outcome === "done", JSON.stringify(resumed.lifecycle));
    assert.deepEqual(c.commits(), ["commit:kuali.rrss-document.save-button", "commit:ucpath.smart-hr.save-and-submit-button"]);
  });
});
