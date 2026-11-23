/**
 * The workflows a scripted run can execute. Each names its module, the start-plan submission for one subject and the system
 * drivers its steps meet; a driver parks a step with `world.hold()` where the step first touches the system, so the script
 * decides when it ends. Add a workflow here and the executor, the seeded server and the traces serve it.
 */
import { DASHBOARD_CATALOG_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { ReadOnboardingDatesOutputSchema } from "../../../../../src/models/systems/crm/read-onboarding-dates.js";
import { CrmDiscoveredRecordSchema } from "../../../../../src/models/systems/crm/search-onboarding-records.js";
import { UcpathPayPathReadSchema, type UcpathPayPathDriver } from "../../../../../src/models/ui/ucpath-paypath.js";
import { CrmDocDownloadCanonicalInput } from "../../../../../src/models/workflows/crm-doc-download/input.js";
import { PersonLookupInput } from "../../../../../src/models/workflows/person-lookup/input.js";
import { WorkStudyInput } from "../../../../../src/models/workflows/work-study/input.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../../src/rules/time/clock.js";
import type { BrowserDriver } from "../../../../../src/workflow-kit/task.js";

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

export const SCRIPTED_WORKFLOWS: readonly ScriptedWorkflow[] = Object.freeze([WORK_STUDY_SCRIPT, PERSON_LOOKUP_SCRIPT, CRM_DOC_DOWNLOAD_SCRIPT]);

export function scriptedWorkflow(workflowId: string): ScriptedWorkflow {
  const script = SCRIPTED_WORKFLOWS.find(candidate => candidate.module.descriptor.id === workflowId);
  if (script === undefined) throw new Error(`no scripted workflow ${workflowId}; scripted: ${SCRIPTED_WORKFLOWS.map(candidate => candidate.module.descriptor.id).join(", ")}`);
  return script;
}

export const scriptedDescriptorOf = (workflowId: string) => SCRIPTED_WORKFLOWS.find(candidate => candidate.module.descriptor.id === workflowId)?.module.descriptor;
