import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { dataOriginViewsOf } from "../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { stepProofModuleOf } from "../../../src/backend/app/registries/step-proof-modules.js";
import { buildRunGate } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { projectObservedOperatorFields } from "../../../src/backend/runs/queries/run-logs.js";
import { readRerunValues } from "../../../src/backend/runs/start/rerun-values.js";
import { readRunCheckpoint } from "../../../src/backend/storage/sqlite/run-continuation.js";
import { previewRerunWarnings } from "../../../src/backend/runs/start/rerun.js";
import { MatchIdentityOutputSchema } from "../../../src/models/workflows/separations/match-identity.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { runClaim, type RunRecord } from "../../../src/models/run/record.js";
import { projectFailureForOperator } from "../../../src/models/trust/failure.js";
import { separationsWorkflow } from "../../../src/workflows/separations/workflow.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { createReferenceCheckWriteWorld } from "../../support/helpers/backend/reference-check-write-world.js";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { registeredModule, separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../../src/backend/systems/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { parsePersonOrgGridRows, searchPersonOrgWithPagePort, type PersonOrgSearchPageOutcome } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { createDeterministicUcpathSmartHrWorldDriver, createUcpathSmartHrFakeWorld } from "../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { UCPATH_PERSON_ORG_DETAIL_READY, UCPATH_PERSON_ORG_DETAIL_SCREEN, UCPATH_PERSON_ORG_DISPLAYED_EID, UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN } from "../../../src/models/ui/ucpath-person-org.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FINALIZATION_JOB_SUMMARY_READ, FINALIZATION_NAME_SEARCH_OUTPUT } from "../../support/helpers/kuali-finalization-fixtures.js";
import { KUALI_SEPARATION_FORM_TYPE } from "../../../src/models/ui/kuali-separation-document.js";
import { COMPOSITION_ACTION_ID, COMPOSITION_DOCUMENT_NAME, COMPOSITION_LAST_DAY_WORKED, COMPOSITION_SEPARATION_DATE, COMPOSITION_DOCUMENT, COMPOSITION_EID, COMPOSITION_NOW, COMPOSITION_RECEIPT,
  COMPOSITION_UCPATH_NAME } from "../../support/helpers/separations-composition-fixtures.js";

const world = createReferenceCheckWriteWorld();
afterEach(world.cleanup);
const proof = stepProofModuleOf("separations-reference-check");
assert.ok(proof);
const { descriptor } = proof;
const INPUT = { emplId: "10000001", employeeName: "Lee, Jordan" };
/** A name the approved subject never carries, so finding it anywhere in the run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";
const START_GATE = "reference-field-review-start";
const APPROVAL_GATE = "reference-field-review-approval";
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
  it("checks the document as it resolves and makes every write wait for the generated reference gate", () => {
    const keys = separationsDescriptor.timeline.map(step => step.key);
    assert.ok(keys.indexOf("reference-check") < keys.indexOf("identity-check"));
    assert.ok(upstreamOf("reference-fields-approval").has("approval"));
    const review = node(APPROVAL_GATE);
    assert.ok(review.kind === "gate" && review.resolvedBy === "operator");
    assert.deepEqual(review.when, { kind: "is-present", of: { from: "node", nodeId: "reference-fields-approval", path: "review" } });
    for (const write of nodes.filter(candidate => candidate.kind === "transaction")) {
      assert.ok(upstreamOf(String(write.id)).has(APPROVAL_GATE), `${String(write.id)} waits for the reference review`);
    }
    assert.equal(upstreamOf(APPROVAL_GATE).has("clear-pending"), false, "the review comes before the first write");
  });

  it("skips the check with no spreadsheet picked and asks nothing", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, []));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.nodeSpans(run, "reference-fields-start"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.nodeSpans(run, START_GATE), [["skipped", "condition-false"]]);
    assert.deepEqual(f.checkLines(run), []);
  });

  it("separations/reference-check — goes on without asking when the picked spreadsheet holds the person", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, [f.holding()]));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.checkLines(run), ["People, row 3: Employee ID matches", "People, row 3: Legal name matches"]);
    assert.deepEqual(f.nodeSpans(run, START_GATE), [["skipped", "condition-false"]]);
  });

  it("separations-reference-check/reference-check — logs an absent row and continues", async () => {
    const f = await fixture(), done = await f.execute(f.start(INPUT, [f.missing()]));
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done");
    assert.deepEqual(f.checkLines(done), ["Not in Issued"]);
  });

  it("stops with the same card when the name differs, with the row value visible only in review, and Cancel run ends it", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.renamed()]);
    assert.equal((await f.execute(started)).lifecycle.state, "parked-gate");
    const decision = f.card(started);
    assert.equal(decision.type, "review-before-write");
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, `People, row 2 · Legal name: spreadsheet “${ROW_ONLY_NAME}”, workflow “Lee, Jordan”`);
    assert.equal(JSON.stringify(f.events(started)).includes(ROW_ONLY_NAME), false);
    assert.equal(f.cancel(started).state, "applied");
    const cancelled = f.current(started);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  });

  it("keeps the standalone proof's dry-run capability unchanged", async () => {
    const f = await fixture();
    assert.throws(() => f.start(INPUT, [f.missing()], true), /dry-run-unsupported/u);
  });
});

describe("Separations composition with a reference spreadsheet", () => {
  const REFERENCE_GATE = "reference-field-review-document";
  const OMIT_KRONOS = [{ step: "kronos-timecard", facts: { lastDayWorked: "06/12/2026", separationDate: "06/19/2026" } }];

  async function composition(options: Readonly<{ documentEid?: string; searchOutcome?: PersonOrgSearchPageOutcome; beforeKualiFinalization?: () => void }> = {}) {
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
      kuali: () => {
        const driver = createDeterministicKualiDriver(kuali, clock);
        return { ...driver, stageSeparationFinalization: (input: Parameters<typeof driver.stageSeparationFinalization>[0]) => {
          options.beforeKualiFinalization?.();
          return driver.stageSeparationFinalization(input);
        } };
      },
      ucpath: () => {
        const person = createDeterministicUcpathPersonOrgDriver(FINALIZATION_NAME_SEARCH_OUTPUT, FINALIZATION_JOB_SUMMARY_READ);
        const filing = createDeterministicUcpathSmartHrWorldDriver(ucpath, () => clock.now());
        const personScreens: readonly unknown[] = [UCPATH_PERSON_ORG_SEARCH_SCREEN, UCPATH_PERSON_ORG_DETAIL_SCREEN];
        const personStates: readonly unknown[] = [UCPATH_PERSON_ORG_SEARCH_READY, UCPATH_PERSON_ORG_DETAIL_READY];
        // The person-org fake owns the search screens; the Smart HR world owns the transaction pages.
        return { ...person, scanTerminationTransactions: filing.scanTerminationTransactions, stageTermination: filing.stageTermination,
          stagePendingTerminationSweep: filing.stagePendingTerminationSweep,
          commit: filing.commit,
          searchPersonOrg: (input: typeof searches[number]) => {
            searches.push(input);
            const outcome = options.searchOutcome;
            if (outcome === undefined) return person.searchPersonOrg(input);
            return searchPersonOrgWithPagePort(() => undefined, {
              search: async () => outcome,
              drill: async () => assert.fail("a nonmatching row must never be opened"),
              returnToResults: async () => assert.fail("a nonmatching row must never be opened"),
            }, input);
          },
          goto: (next: never) => personScreens.includes(next) ? person.goto(next) : filing.goto(next),
          waitFor: (stateId: never) => personStates.includes(stateId) ? person.waitFor(stateId) : filing.waitFor(stateId),
          read: (id: never) => id === UCPATH_PERSON_ORG_DISPLAYED_EID ? person.read(id) : filing.read(id) };
      },
    });
    const f = await world.fixture(separationsDescriptor, sessions);
    const commits = () => [...kuali.events, ...ucpath.events].filter(event => event.startsWith("commit:"));
    const begin = (picks: Parameters<typeof f.start>[1], dryRun = false, stepOmissions: readonly { step: string; facts: Record<string, unknown> }[] = OMIT_KRONOS) =>
      f.start({ documentNumber: COMPOSITION_DOCUMENT }, picks, dryRun, { stepOmissions,
        selectedStepKeys: separationsDescriptor.timeline.map(step => step.key).filter(key => !stepOmissions.some(omitted => omitted.step === key)) });
    const writeIntents = (run: RunRecord) => f.database.authority.writeIntents.listByRun(run.envelope.runId);
    const holding = () => f.spreadsheet("Separations roster", "People", ["eid", "fullName"], [["10000009", "Blair Example"], [COMPOSITION_EID, COMPOSITION_UCPATH_NAME]]);
    const missing = () => f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]]);
    const renamed = () => f.spreadsheet("Separations roster", "People", ["fullName", "eid"], [[ROW_ONLY_NAME, COMPOSITION_EID]]);
    const parkedAt = (run: RunRecord) => run.lifecycle.state === "parked-gate" ? String(run.lifecycle.gateId) : run.lifecycle.state;
    return { ...f, commits, begin, writeIntents, holding, missing, renamed, parkedAt, searches, ucpath, kuali };
  }

  it("stops before searching UCPath when the Kuali document has no Employee ID", async () => {
    const c = await composition({ documentEid: "" });
    const run = await c.execute(c.begin([], true));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const [failure] = c.database.authority.failures.listByRun(run.envelope.runId);
    assert.equal(failure?.nodeId, "subject");
    assert.equal(failure.code, "EMPLOYEE_ID_ABSENT");
    assert.match(failure.summary, /Kuali document 4444.*Employee ID/u);
    assert.match(projectFailureForOperator(failure, true).summary, /The separation document has no Employee ID/u);
    assert.deepEqual(c.searches, []);
    assert.deepEqual(c.nodeSpans(run, "job-summary"), []);
    assert.deepEqual(c.writeIntents(run), []);
  });

  const unmatchedOutcomes: readonly PersonOrgSearchPageOutcome[] = [
    { kind: "not-found", marker: "No matching values were found" },
    { kind: "grid", rows: parsePersonOrgGridRows([
      ["10000009", "0", "Active", "SDCMP", "004921", "Fictional analyst", "Example", "Blair Example"],
    ]) },
  ];

  it.each(unmatchedOutcomes)("stops before Job Summary when $kind has no exact Employee ID match", async searchOutcome => {
    const c = await composition({ searchOutcome });
    const run = await c.execute(c.begin([], true));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed");
    const [failure] = c.database.authority.failures.listByRun(run.envelope.runId);
    assert.equal(failure?.nodeId, "subject");
    assert.equal(failure.code, "EMPLOYEE_ID_NO_MATCH");
    assert.match(failure.summary, /No UCPath person matched Employee ID ••••0000/u);
    const card = projectFailureForOperator(failure, true);
    assert.match(card.summary, /No UCPath person matches the Employee ID on the separation document/u);
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

  it("logs the absent row and files each write once", async () => {
    const c = await composition(), started = c.begin([c.missing()]);
    const run = await c.execute(started);
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", c.parkedAt(run));
    assert.deepEqual(c.checkLines(run), ["Not in Issued"]);
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

  it("continues a dry run with a missing row and records the Logs line", async () => {
    const c = await composition(), run = await c.execute(c.begin([c.missing()], true));
    assert.notEqual(c.parkedAt(run), REFERENCE_GATE);
    assert.deepEqual(c.nodeSpans(run, REFERENCE_GATE), [["skipped", "condition-false"]]);
    assert.deepEqual(c.checkLines(run), ["Not in Issued"]);
    assert.deepEqual(c.commits(), []);
  });

  it("resumes from stored state after Continue without asking on the same field again", async () => {
    const c = await composition(), started = c.begin([c.renamed()]);
    assert.equal(c.parkedAt(await c.execute(started)), REFERENCE_GATE);
    assert.deepEqual(c.commits(), []);
    assert.deepEqual(c.writeIntents(started), []);
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
    assert.deepEqual(c.checkLines(run), ["People, row 3: Employee ID matches", "People, row 3: Legal name matches"]);
  });

  it("sends no UCPath write when its form actions were done by hand, and records the typed receipt", async () => {
    const c = await composition();
    // The termination someone filed by hand, as UCPath now shows it.
    c.ucpath.rows.push({ transactionId: COMPOSITION_RECEIPT, emplId: COMPOSITION_EID, action: "TER", approvalStatus: "Approved", startDate: "06/22/2026", displayedName: COMPOSITION_UCPATH_NAME });
    c.ucpath.employmentRecords.push({ transactionId: COMPOSITION_RECEIPT, emplRecord: "0" });
    const run = await c.execute(c.begin([], false, [...OMIT_KRONOS, { step: "pending-termination", facts: {} },
      { step: "ucpath-transaction", facts: { transactionNumber: COMPOSITION_RECEIPT, approvalStatus: "Approved", effectiveDate: "06/22/2026" } }]));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(run.lifecycle));
    assert.deepEqual(c.commits(), ["commit:kuali.rrss-document.save-button"]);
    assert.deepEqual(c.writeIntents(run).map(intent => intent.system), ["kuali"]);
    for (const skipped of ["pending-set", "clear-pending", "file-termination"]) assert.deepEqual(c.nodeSpans(run, skipped), [["skipped", "step-omitted"]], skipped);
    const receipt = c.database.authority.runCheckpoints.listByItem(separationsDescriptor.id, run.envelope.itemId).find(record => record.nodeId === "receipt");
    assert.equal((receipt?.output.value as { effectiveDate?: string } | undefined)?.effectiveDate, "06/22/2026", "the receipt carries the typed filing date, not the plan's 06/20/2026");
  });

  it("reruns a filed termination whose pending sweep was done by hand, warning of the filed write", async () => {
    const c = await composition();
    const omissions = [...OMIT_KRONOS, { step: "pending-termination", facts: {} }];
    const run = await c.execute(c.begin([], false, omissions));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(run.lifecycle));
    assert.deepEqual(c.nodeSpans(run, "clear-pending"), [["skipped", "step-omitted"]]);
    const plan = previewRerunWarnings(c.database.authority, separationsDescriptor, { runId: run.envelope.runId, expectedVersion: run.version, intent: "rerun",
      selectedStepKeys: separationsDescriptor.timeline.map(step => step.key).filter(key => !omissions.some(omitted => omitted.step === key)) });
    assert.ok(plan.warnings.some(warning => warning.nodeId === "file-termination"), JSON.stringify(plan.warnings));
  });

  it("reruns unfinished steps after an interruption with the pending sweep done by hand, without filing again", async () => {
    const abort = new AbortController();
    const c = await composition({ beforeKualiFinalization: () => abort.abort() });
    const active = await c.execute(c.begin([], false, [...OMIT_KRONOS, { step: "pending-termination", facts: {} }]), abort.signal);
    assert.ok(abort.signal.aborted);
    assert.deepEqual(c.nodeSpans(active, "clear-pending"), [["skipped", "step-omitted"]]);
    assert.deepEqual(c.commits(), ["commit:ucpath.smart-hr.save-and-submit-button"]);
    const claim = runClaim(active);
    assert.ok(claim, JSON.stringify(active.lifecycle));
    const endedAt = c.clock.now().toISOString();
    const interrupted = c.database.authority.runs.transition({
      runId: active.envelope.runId, expectedVersion: active.version,
      claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: endedAt,
      lifecycle: { state: "terminal", outcome: "interrupted", endedAt },
    });
    assert.ok(interrupted.state === "applied", JSON.stringify(interrupted));
    const source = { runId: interrupted.run.envelope.runId, expectedVersion: interrupted.run.version };
    const values = readRerunValues({ database: c.database, reader: testRunService(c.database, c.clock),
      descriptors: { resolve: id => id === separationsDescriptor.id ? separationsDescriptor : undefined } }, source);
    assert.ok(values.state === "available" && values.snapshot.retainedSteps !== undefined, JSON.stringify(values));
    const retained = new Set(values.snapshot.retainedSteps.map(step => step.key));
    const selectedStepKeys = separationsDescriptor.timeline.map(step => step.key).filter(key => !retained.has(key));
    assert.ok(selectedStepKeys.includes("kuali-finalization"));
    const successor = c.start(undefined, [], values.snapshot.source.dryRun, {
      selectedStepKeys, rerunSource: { ...source, intent: "rerun", selectedStepKeys },
    });
    assert.ok(successor.envelope.continuation !== undefined);
    const done = await c.execute(successor);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(c.commits(), ["commit:kuali.rrss-document.save-button", "commit:ucpath.smart-hr.save-and-submit-button"], "the termination is filed once");
    assert.deepEqual(c.writeIntents(done).map(intent => intent.system), ["kuali"]);
  });

  it("refuses a manual approval whose Employee ID is not the run's before any write", async () => {
    const c = await composition();
    const review = (emplId: string) => [...OMIT_KRONOS, { step: "identity-review", facts: { emplId, ucpathName: COMPOSITION_UCPATH_NAME } }];
    const wrong = await c.execute(c.begin([], false, review("10000009")));
    assert.ok(wrong.lifecycle.state === "terminal" && wrong.lifecycle.outcome !== "done", JSON.stringify(wrong.lifecycle));
    assert.deepEqual(c.commits(), []);
    assert.deepEqual(c.writeIntents(wrong), []);
    assert.deepEqual(c.nodeSpans(wrong, "pending-set"), [], "the run stops at the approval, before UCPath is touched");
    const bound = await c.execute(c.begin([], false, review(COMPOSITION_EID)));
    assert.ok(bound.lifecycle.state === "terminal" && bound.lifecycle.outcome === "done", JSON.stringify(bound.lifecycle));
  });

  it("skips identity approval when the document carries the Employee ID and the Kronos timecard is omitted", async () => {
    const c = await composition({ documentEid: COMPOSITION_EID }), started = c.begin([c.holding()]);
    const resumed = await c.execute(started);
    assert.deepEqual(c.searches, [{ kind: "by-eid", emplId: COMPOSITION_EID }]);
    assert.deepEqual(c.nodeSpans(resumed, "identity-approval"), [["skipped", "condition-false"]]);
    const checkpoint = readRunCheckpoint(c.database.authority, resumed.envelope, "comparison");
    const comparison = MatchIdentityOutputSchema.parse(checkpoint?.output.value);
    assert.equal(comparison.approvalRequired, false);
    assert.ok(comparison.packet.comparisons.some(row => row.documentValue === COMPOSITION_EID
      && row.note === "the Employee ID lookup and Job Summary confirm the same person"));
    assert.ok(resumed.lifecycle.state === "terminal" && resumed.lifecycle.outcome === "done", JSON.stringify(resumed.lifecycle));
    assert.deepEqual(c.commits(), ["commit:kuali.rrss-document.save-button", "commit:ucpath.smart-hr.save-and-submit-button"]);
  });
});
