/**
 * The workflows a scripted run can execute. Each names its module, the start-plan submission for one subject and the system
 * drivers its steps meet; a driver parks a step with `world.hold()` where the step first touches the system, so the script
 * decides when it ends. Add a workflow here and the executor, the seeded server and the traces serve it.
 */
import { DASHBOARD_CATALOG_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { createDeterministicKualiDriver, createKualiFakeWorld, type KualiFakeWorld } from "../../../../../src/backend/systems/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { createDeterministicUcpathSmartHrWorldDriver, createUcpathSmartHrFakeWorld, type UcpathSmartHrFakeWorld } from "../../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { ReadOnboardingDatesOutputSchema } from "../../../../../src/models/systems/crm/read-onboarding-dates.js";
import { CrmDiscoveredRecordSchema } from "../../../../../src/models/systems/crm/search-onboarding-records.js";
import { REFERENCE_CHECK_REVIEW_GATE } from "../../../../../src/models/processing/workbooks/reference-check-stop.js";
import { KUALI_SEPARATION_FORM_TYPE } from "../../../../../src/models/ui/kuali-separation-document.js";
import { UCPATH_PERSON_ORG_DETAIL_READY, UCPATH_PERSON_ORG_DETAIL_SCREEN, UCPATH_PERSON_ORG_DISPLAYED_EID, UCPATH_PERSON_ORG_SEARCH_READY, UCPATH_PERSON_ORG_SEARCH_SCREEN } from "../../../../../src/models/ui/ucpath-person-org.js";
import { UcpathPayPathReadSchema, type UcpathPayPathDriver } from "../../../../../src/models/ui/ucpath-paypath.js";
import { CrmDocDownloadCanonicalInput } from "../../../../../src/models/workflows/crm-doc-download/input.js";
import { PersonLookupInput } from "../../../../../src/models/workflows/person-lookup/input.js";
import { WorkStudyInput } from "../../../../../src/models/workflows/work-study/input.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { SeparationsInput } from "../../../../../src/workflows/separations/workflow.js";
import type { TestClock } from "../../../../../src/rules/time/clock.js";
import type { BrowserDriver } from "../../../../../src/workflow-kit/task.js";
import { COMPOSITION_ACTION_ID, COMPOSITION_DOCUMENT_NAME, COMPOSITION_EID, COMPOSITION_RECEIPT, COMPOSITION_UCPATH_NAME } from "../../separations-composition-fixtures.js";
import { FINALIZATION_JOB_SUMMARY_READ, FINALIZATION_NAME_SEARCH_OUTPUT } from "../../kuali-finalization-fixtures.js";
import { createDeterministicNewKronosDriver } from "./new-kronos-fake.js";

export interface RecordedWrite {
  readonly runId: string;
  readonly nodeId: string;
  readonly eid: string;
}

/** What a driver may ask of the executor while a run is driven. */
export interface ScriptWorld {
  readonly clock: TestClock;
  /** Parks the calling step until the script answers; throws when the script fails it. */
  hold(): Promise<void>;
  /** The run being driven: its subject, the node it is held at, and whether the script loses the commit's answer. */
  readonly run: () => Readonly<{ runId: string; subject: string; heldNode: () => string; loseAnswer: () => boolean }>;
  record(write: RecordedWrite): void;
}

export interface ScriptedWorkflow {
  readonly module: (typeof DASHBOARD_CATALOG_MODULES)[number];
  /** The start-plan submission for one subject. */
  submission(subject: string): Record<string, unknown>;
  /** The subject (an employee ID) a stored run input names. */
  subjectOf(input: unknown): string;
  /** The transaction's node, for workflows that write; a script holds it before it stages. */
  readonly writeNode?: string;
  drivers(world: ScriptWorld): Readonly<Record<string, (openIndex: number) => BrowserDriver>>;
}

function catalogModule(id: string): (typeof DASHBOARD_CATALOG_MODULES)[number] {
  const found = DASHBOARD_CATALOG_MODULES.find(module => module.descriptor.id === id);
  if (found === undefined) throw new Error(`the dashboard catalog serves no ${id} workflow`);
  return found;
}

type PayPathWorld = ReturnType<typeof deterministicPayPathOperations>;
export const WORK_STUDY_GATE_ID = REFERENCE_CHECK_REVIEW_GATE;
const EFFECTIVE_DATE = "08/03/2026";

/**
 * Work-Study: a UCPath read, an operator gate that opens when a picked reference spreadsheet does not hold the employee,
 * then one transaction. The dashboard bundle renders only workflows the product declares, so the script drives a product one.
 */
export const WORK_STUDY_SCRIPT: ScriptedWorkflow = {
  module: catalogModule("work-study"),
  writeNode: "save-transaction",
  submission: eid => ({ emplId: eid, effectiveDate: EFFECTIVE_DATE }),
  subjectOf: input => WorkStudyInput.parse(input).emplId,
  drivers(world) {
    /** One PayPath per employee, so a run resumed after its gate meets the transactions its employee already has. */
    const paypaths = new Map<string, PayPathWorld>();
    const paypathOf = (eid: string): PayPathWorld => {
      const known = paypaths.get(eid);
      if (known !== undefined) return known;
      const now = world.clock.now().toISOString();
      const created = deterministicPayPathOperations({ now, read: UcpathPayPathReadSchema.parse({
        pageStateId: "ucpath.paypath.position-data-ready", observedAt: now, emplId: eid, displayedName: "Lee, Jordan",
        position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
      }) });
      paypaths.set(eid, created);
      return created;
    };
    const current = (): PayPathWorld => paypathOf(world.run().subject);
    /** UCPath as the run's worker sees it: no page, the employee's deterministic PayPath, and a pause where the script holds. */
    const paypath: UcpathPayPathDriver & Pick<PayPathWorld, "readTransactionFindings" | "read"> = {
      readPayPathPosition: async (input) => { await world.hold(); return current().readPayPathPosition(input); },
      stagePayPathWorkStudy: async (target) => { await world.hold(); return current().stagePayPathWorkStudy(target); },
      readPayPathSubject: () => current().readPayPathSubject(),
      submitPayPathWorkStudy: async (input, capability) => {
        const run = world.run();
        // Recorded when asked, before the fake answers: a second Save for the same run shows as a second entry even if it is refused.
        world.record({ runId: run.runId, nodeId: run.heldNode(), eid: input.emplId });
        await current().submitPayPathWorkStudy(input, capability);
        if (run.loseAnswer()) throw new Error("the Save and Submit answer was not observed");
      },
      readTransactionFindings: (input) => current().readTransactionFindings(input),
      read: (id) => current().read(id),
    };
    return { ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath }) };
  },
};

/** Person Lookup: a UCPath search by employee ID, a CRM cross-check and the CRM dates; it writes nothing. */
export const PERSON_LOOKUP_SCRIPT: ScriptedWorkflow = {
  module: catalogModule("person-lookup"),
  submission: eid => ({ emplId: eid, includeCrmDates: true }),
  subjectOf: input => {
    const parsed = PersonLookupInput.parse(input);
    if (!("emplId" in parsed)) throw new Error("the scripted Person Lookup run was not started by employee ID");
    return parsed.emplId;
  },
  drivers(world) {
    const ucpath = createDeterministicUcpathPersonOrgDriver();
    const crmFor = (eid: string) => {
      const record = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1",
        emplId: EidSchema.parse(eid), name: "Deterministic, Person", department: "Housing Dining Hospitality", firstDayOfService: "07/01/2026", dateSigned: "06/25/2026" });
      return createDeterministicCrmOnboardingDriver({ discovery: [record],
        record: { state: "found", record: { recordId: record.recordId, emplId: record.emplId, fullName: record.name, rawStage: "Completed" } },
        dates: ReadOnboardingDatesOutputSchema.parse({ emplId: record.emplId, state: "read", employmentDate: "2026-07-01", oathDate: "2026-06-25", reason: "" }) });
    };
    return {
      ucpath: () => ({ ...ucpath, searchPersonOrg: async (request: Parameters<typeof ucpath.searchPersonOrg>[0]) => { await world.hold(); return ucpath.searchPersonOrg(request); } }),
      crm: () => {
        const crm = crmFor(world.run().subject);
        return { ...crm,
          searchOnboardingRecords: async (request: Parameters<typeof crm.searchOnboardingRecords>[0]) => { await world.hold(); return crm.searchOnboardingRecords(request); },
          readOnboardingDates: async (request: Parameters<typeof crm.readOnboardingDates>[0]) => { await world.hold(); return crm.readOnboardingDates(request); } };
      },
    };
  },
};

/** The work email the scripted CRM record of an employee carries, and the key its roster row needs. */
export const crmDocEmail = (eid: string): string => `eid${eid}@example.test`;
export const CRM_DOC_FILE_NAME = "Signed Offer Letter.pdf";

/** CRM Document Download: a CRM record search and an iDocs download for one employee, then one archive per roster worksheet; it writes to no system. */
export const CRM_DOC_DOWNLOAD_SCRIPT: ScriptedWorkflow = {
  module: catalogModule("crm-doc-download"),
  submission: eid => ({ people: eid }),
  subjectOf: input => {
    const [person] = CrmDocDownloadCanonicalInput.parse(input).people;
    if (person?.kind !== "eid") throw new Error("the scripted CRM Document Download run was not started by employee ID");
    return person.value;
  },
  drivers(world) {
    const crmFor = (eid: string) => createDeterministicCrmOnboardingDriver({
      record: { state: "absent", queriedEid: EidSchema.parse(eid), reason: "unused by this workflow" }, dates: ReadOnboardingDatesOutputSchema.parse({ emplId: EidSchema.parse(eid), state: "no-confident-record", employmentDate: null, oathDate: null, reason: "" }),
      documents: [{ identity: { recordId: "ONB-1", eid: EidSchema.parse(eid), workEmail: crmDocEmail(eid), personalEmail: null }, totalDocuments: 1,
        documents: [{ index: 0, fileName: CRM_DOC_FILE_NAME, bytes: new TextEncoder().encode(`%PDF-1.7 synthetic ${eid}`) }] }] });
    return { crm: () => {
      const crm = crmFor(world.run().subject);
      return { ...crm,
        findDocumentRecord: async (subject: Parameters<typeof crm.findDocumentRecord>[0]) => { await world.hold(); return crm.findDocumentRecord(subject); },
        readIdocs: async (request: Parameters<typeof crm.readIdocs>[0]) => { await world.hold(); return crm.readIdocs(request); } };
    } };
  },
};


const SEPARATION_LAST_DAY = "06/12/2026";
type KualiDriver = ReturnType<typeof createDeterministicKualiDriver>;

/** One Kuali document's systems: the document and its form, and the employee's Smart HR transactions. Worlds are per document, so runs never share a filing. */
interface SeparationWorld { readonly kuali: KualiFakeWorld; readonly ucpath: UcpathSmartHrFakeWorld }

/**
 * Separations: a Kuali document read, a UCPath person and job search, a Kronos timecard read, then the UCPath termination and the Kuali finalization.
 * Each step parks where it first touches a system. The document carries the employee ID, so no identity gate opens; it writes twice, once to UCPath and once to Kuali.
 */
export const SEPARATIONS_SCRIPT: ScriptedWorkflow = {
  module: catalogModule("separations"),
  submission: documentNumber => ({ documentNumber }),
  subjectOf: input => SeparationsInput.parse(input).documentNumber,
  drivers(world) {
    const worlds = new Map<string, SeparationWorld>();
    const worldOf = (documentNumber: string): SeparationWorld => {
      const known = worlds.get(documentNumber);
      if (known !== undefined) return known;
      const kuali = createKualiFakeWorld({ actionId: COMPOSITION_ACTION_ID, documentNumber, displayedEid: COMPOSITION_EID });
      kuali.separationForm = { formType: KUALI_SEPARATION_FORM_TYPE, employeeName: COMPOSITION_DOCUMENT_NAME, eid: COMPOSITION_EID, employeeType: "Student",
        studentTitleCode: "4921 - STDT 2", division: "Campus Dining and Retail", location: "Synthetic Hall", terminationType: "Move out of Area",
        lastDayWorked: SEPARATION_LAST_DAY, separationDate: SEPARATION_LAST_DAY, additionalComments: "", requestAcknowledged: false,
        timekeeperName: "", timekeeperComments: "", terminationEffectiveDate: "", department: "- - -", payrollTitleCode: "", payrollTitle: "",
        submittedTerminationTemplate: false, transactionNumber: "", finalPay: null };
      const created = { kuali, ucpath: createUcpathSmartHrFakeWorld({ emplId: COMPOSITION_EID, displayedName: COMPOSITION_UCPATH_NAME, nextTransactionId: COMPOSITION_RECEIPT }) };
      worlds.set(documentNumber, created);
      return created;
    };
    /** A step parks once, at its first touch of a system; its later reads and its stage and commit run on. */
    const parked = new Set<string>();
    const hold = async (): Promise<void> => {
      const run = world.run();
      const step = `${run.runId}/${run.heldNode()}`;
      if (parked.has(step)) return;
      parked.add(step);
      await world.hold();
    };
    const recordWrite = (): void => { const run = world.run(); world.record({ runId: run.runId, nodeId: run.heldNode(), eid: COMPOSITION_EID }); };
    return {
      kuali: () => {
        const drivers = new Map<string, KualiDriver>();
        const driver = () => {
          const subject = world.run().subject;
          const known = drivers.get(subject);
          if (known !== undefined) return known;
          const created = createDeterministicKualiDriver(worldOf(subject).kuali, world.clock);
          drivers.set(subject, created);
          return created;
        };
        return { system: "kuali" as const, read: (id: Parameters<KualiDriver["read"]>[0]) => driver().read(id),
          readActionListForDocument: async (request: Parameters<KualiDriver["readActionListForDocument"]>[0]) => { await hold(); return driver().readActionListForDocument(request); },
          readSeparationDocument: async (request: Parameters<KualiDriver["readSeparationDocument"]>[0]) => { await hold(); return driver().readSeparationDocument(request); },
          stageSeparationFinalization: async (target: Parameters<KualiDriver["stageSeparationFinalization"]>[0]) => { await hold(); return driver().stageSeparationFinalization(target); },
          readSavedSeparationFinalization: async (target: Parameters<KualiDriver["readSavedSeparationFinalization"]>[0]) => { await hold(); return driver().readSavedSeparationFinalization(target); },
          commit: async (id: Parameters<KualiDriver["commit"]>[0], capability: Parameters<KualiDriver["commit"]>[1]) => { recordWrite(); return driver().commit(id, capability); } };
      },
      ucpath: () => {
        const person = createDeterministicUcpathPersonOrgDriver(FINALIZATION_NAME_SEARCH_OUTPUT, FINALIZATION_JOB_SUMMARY_READ);
        const filings = new Map<string, ReturnType<typeof createDeterministicUcpathSmartHrWorldDriver>>();
        const filing = () => {
          const subject = world.run().subject;
          const known = filings.get(subject);
          if (known !== undefined) return known;
          const created = createDeterministicUcpathSmartHrWorldDriver(worldOf(subject).ucpath, () => world.clock.now());
          filings.set(subject, created);
          return created;
        };
        const personScreens: readonly unknown[] = [UCPATH_PERSON_ORG_SEARCH_SCREEN, UCPATH_PERSON_ORG_DETAIL_SCREEN];
        const personStates: readonly unknown[] = [UCPATH_PERSON_ORG_SEARCH_READY, UCPATH_PERSON_ORG_DETAIL_READY];
        // The person-org fake owns the search screens; the Smart HR world owns the transaction pages.
        return { ...person,
          searchPersonOrg: async (request: Parameters<typeof person.searchPersonOrg>[0]) => { await hold(); return person.searchPersonOrg(request); },
          readJobSummary: async (request: Parameters<typeof person.readJobSummary>[0]) => { await hold(); return person.readJobSummary(request); },
          scanTerminationTransactions: async (request: Parameters<typeof person.scanTerminationTransactions>[0]) => { await hold(); return filing().scanTerminationTransactions(request); },
          stageTermination: (request: Parameters<typeof person.stageTermination>[0]) => filing().stageTermination(request),
          stagePendingTerminationSweep: (request: Parameters<typeof person.stagePendingTerminationSweep>[0]) => filing().stagePendingTerminationSweep(request),
          commit: async (id: Parameters<typeof person.commit>[0], capability: Parameters<typeof person.commit>[1]) => { recordWrite(); return filing().commit(id, capability); },
          goto: (next: never) => personScreens.includes(next) ? person.goto(next) : filing().goto(next),
          waitFor: (stateId: never) => personStates.includes(stateId) ? person.waitFor(stateId) : filing().waitFor(stateId),
          read: (id: never) => id === UCPATH_PERSON_ORG_DISPLAYED_EID ? person.read(id) : filing().read(id) };
      },
      "new-kronos": () => createDeterministicNewKronosDriver({ employeeId: COMPOSITION_EID, displayName: COMPOSITION_DOCUMENT_NAME,
        punchDates: [SEPARATION_LAST_DAY], now: () => world.clock.now(), hold }),
    };
  },
};

export const SCRIPTED_WORKFLOWS: readonly ScriptedWorkflow[] = Object.freeze([WORK_STUDY_SCRIPT, PERSON_LOOKUP_SCRIPT, CRM_DOC_DOWNLOAD_SCRIPT, SEPARATIONS_SCRIPT]);

export function scriptedWorkflow(workflowId: string): ScriptedWorkflow {
  const script = SCRIPTED_WORKFLOWS.find(candidate => candidate.module.descriptor.id === workflowId);
  if (script === undefined) throw new Error(`no scripted workflow ${workflowId}; scripted: ${SCRIPTED_WORKFLOWS.map(candidate => candidate.module.descriptor.id).join(", ")}`);
  return script;
}

export const scriptedDescriptorOf = (workflowId: string) => SCRIPTED_WORKFLOWS.find(candidate => candidate.module.descriptor.id === workflowId)?.module.descriptor;
