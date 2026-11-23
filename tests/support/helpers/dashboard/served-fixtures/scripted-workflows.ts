/**
 * The workflows a scripted run can execute. Each names its module, the start-plan submission for one subject and the system
 * drivers its steps meet; a driver parks a step with `world.hold()` where the step first touches the system, so the script
 * decides when it ends. Add a workflow here and the executor, the seeded server and the traces serve it.
 */
import { DASHBOARD_CATALOG_MODULES, READABLE_WORKFLOW_MODULES, } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createDeterministicContactPersistence } from "../../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { ocrForm } from "../../../../../src/models/ocr/form-registry.js";
import type { ArtifactRef } from "../../../../../src/models/artifacts/artifacts.js";
import { ExtractPdfPages } from "../../../../../src/models/processing/extraction/extract-pdf-pages.js";
import type { ExtractPdfPagesOutputSchema } from "../../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { SearchPersonOrgOutputSchema } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import { UcpathContactPageSnapshotSchema } from "../../../../../src/models/ui/ucpath-emergency-contact.js";
import { EmergencyContactMemberInputSchema } from "../../../../../src/models/workflows/emergency-contact-member/input.js";
import { EmergencyContactInputSchema } from "../../../../../src/models/workflows/emergency-contact/input.js";
import { bindManualOcrPageReading } from "../../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../../../src/models/workflows/ocr/source-manifest.js";
import type { UcpathStoreDriver } from "../../../../../src/models/ui/ucpath-driver.js";
import { defineTask } from "../../../../../src/workflow-kit/task.js";
import { defineServiceStore, type RegisteredTaskStore } from "../../../../../src/workflow-kit/task-registry.js";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import type { z } from "zod";
import contactFixture from "../../../fixtures/ui/ucpath/emergency-contact.fixture.json" with { type: "json" };
import { createDeterministicI9Driver } from "../../../../../src/backend/systems/i9/driver/fake.js";
import { healthyCrmDriver } from "../../phase1f-executor-harness.js";
import { READING_ID, submittedPage } from "../../../fixtures/ocr/source-pages.js";
import { i9Candidate, i9Search } from "../../../fixtures/i9-check.js";
import { i9PageSubmission } from "../../../fixtures/i9-check-start.js";
import { I9CheckStartInput } from "../../../../../src/models/workflows/i9-check/start.js";
import type { UcpathPersonOrgDriver } from "../../../../../src/models/ui/ucpath-person-org.js";
import { randomUUID } from "node:crypto";
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
  /** Stores a PDF the way an operator's upload does, answering the document a run reads. */
  uploadPdf(bytes: Uint8Array): Promise<ArtifactRef>;
  /** Stores a rendered page image. */
  putImage(bytes: Uint8Array): Promise<ArtifactRef>;
}

export interface ScriptedWorkflow {
  readonly module: (typeof DASHBOARD_CATALOG_MODULES)[number];
  /** The start-plan submission for one subject. */
  submission(subject: string): Record<string, unknown>;
  /** The child workflows the run delegates to, which run on this workflow's worker. */
  readonly children?: readonly Readonly<{ descriptor: (typeof DASHBOARD_CATALOG_MODULES)[number]["descriptor"] }>[];
  /** The task stores that replace the registered ones for this workflow's runs, such as a PDF renderer that needs no renderer. */
  stores?(world: ScriptWorld): readonly RegisteredTaskStore[];
  /** The employee ID the operator asserts for an OCR record, read from its answers (raw values by field path); undefined when the review asserts none. */
  assertedEid?(answers: Readonly<Record<string, unknown>>): string | undefined;
  /** Builds the submission for a workflow whose input needs more than the subject, such as an uploaded document. */
  prepare?(world: ScriptWorld, subject: string): Promise<Record<string, unknown>>;
  /** The subject (an employee ID) a run of `workflowId` (this workflow, or a child) names in its stored input. */
  subjectOf(input: unknown, workflowId?: string): string;
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


const childModule = (id: string) => {
  const found = READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id);
  if (found === undefined) throw new Error(`the product registers no ${id} workflow`);
  return found;
};

/** The people an Emergency Contact PDF holds, one page each: their name on the form and the employee ID the identity lookup finds. */
const EC_PEOPLE: Readonly<Record<string, string>> = { "10800000": "Example, Avery", "10800001": "Example, Blake" };
const PNG_PAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGvwAAAAASUVORK5CYII=", "base64");
const renderedPages = new WeakMap<ScriptWorld, Map<string, z.output<typeof ExtractPdfPagesOutputSchema>>>();
const pagesOf = (world: ScriptWorld): Map<string, z.output<typeof ExtractPdfPagesOutputSchema>> => {
  const known = renderedPages.get(world) ?? new Map<string, z.output<typeof ExtractPdfPagesOutputSchema>>();
  renderedPages.set(world, known);
  return known;
};

/**
 * Emergency Contact: a PDF read page by page by the OCR child (identity lookups in UCPath), an operator review that releases the
 * records, then one member run per record that reads the contact page and saves the primary contact. The subject is a comma list of
 * the employee IDs of the pages' people; each page is entered manually so no OCR provider is asked, and no form is filed to OnBase.
 */
export const EMERGENCY_CONTACT_SCRIPT: ScriptedWorkflow = {
  module: catalogModule("emergency-contact"),
  children: ["ocr", "ocr-page", "person-lookup", "i9-lookup", "emergency-contact-member", "onbase"].map(childModule),
  writeNode: "contact-preview",
  submission: () => { throw new Error("an Emergency Contact run is started with its uploaded PDF: use the executor's submission()"); },
  subjectOf: (input, workflowId) => {
    if (workflowId !== "emergency-contact-member") return "";
    const eid = EmergencyContactMemberInputSchema.parse(input).record.assertedEid;
    if (eid === null) throw new Error("the scripted Emergency Contact member run holds no employee ID");
    return eid;
  },
  async prepare(world, subject) {
    const people = subject.split(",").map(eid => ({ eid, name: EC_PEOPLE[eid] }));
    const named = people.flatMap(person => person.name === undefined ? [] : [person.name]);
    if (named.length !== people.length) throw new Error(`the scripted Emergency Contact PDF knows no people for ${subject}`);
    const document = await world.uploadPdf(new TextEncoder().encode(`%PDF-1.7\nSynthetic Emergency Contact ${subject}\n%%EOF`));
    const image = await world.putImage(PNG_PAGE);
    const rendered = { pageCount: people.length, pages: people.map((_, index) => ({ sourcePage: index + 1, image })) };
    pagesOf(world).set(document.sha256, rendered);
    const actorId = "local-operator";
    const pages = ocrPageInputs(buildOcrSourceManifest(document, rendered), READING_ID, "emergency-contact");
    const assertions = pages.map((page, index) => {
      const original = submittedPage(page, named[index], ocrForm("emergency-contact").pageKinds[0]);
      const reading = bindManualOcrPageReading(page, actorId, { ...original, source: { kind: "operator", actorId } });
      return { sourcePage: reading.input.sourcePage, extraction: reading.extraction };
    });
    return EmergencyContactInputSchema.parse({ document, readingId: READING_ID, roster: null, onbaseFiling: "skip",
      reading: { kind: "manual", actorId, assertions } });
  },
  stores(world) {
    const extraction = taskStoreRegistry.stores.find(store => store.namespace === "extraction");
    if (extraction === undefined) throw new Error("the task registry holds no extraction store");
    const render = defineTask(ExtractPdfPages, { sessions: [], async run({ ctx, input }) {
      const rendered = pagesOf(world).get(input.document.sha256);
      if (rendered === undefined) throw new Error("the scripted PDF has no rendered pages");
      ctx.recordData([{ direction: "read", field: "pageCount", value: rendered.pageCount }, { direction: "read", field: "pages", value: rendered.pages }]);
      return rendered;
    } });
    return [defineServiceStore("extraction", Object.fromEntries(Object.entries(extraction.tasks).map(([key, task]) => [key, task.contract.id === ExtractPdfPages.id ? render : task])))];
  },
  drivers(world) {
    const persistence = new Map<string, ReturnType<typeof createDeterministicContactPersistence>>();
    // Each observation is later than the last, as the Save's verification requires.
    let ticks = world.clock.now().getTime();
    const now = () => new Date(++ticks).toISOString();
    return { crm: () => ({ ...healthyCrmDriver(), searchOnboardingRecords: async () => [] }),
      i9: () => createDeterministicI9Driver({ lookup: { i9Status: "not-found", signerName: "" }, now: world.clock.now().toISOString() }),
      ucpath: (): UcpathStoreDriver => {
      const base = createDeterministicUcpathPersonOrgDriver();
      let active: { eid: string; driver: ReturnType<typeof createDeterministicUcpathPersonOrgDriver> } | undefined;
      const forSubject = (input: { emplId: string; expectedName: string }) => {
        if (active?.eid === input.emplId) return active.driver;
        let backend = persistence.get(input.emplId);
        if (backend === undefined) {
          backend = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...contactFixture.page, displayedEid: input.emplId, displayedName: input.expectedName }), now);
          persistence.set(input.emplId, backend);
        }
        const session = backend.session();
        const driver = createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, session.save);
        active = { eid: input.emplId, driver };
        return driver;
      };
      return { ...base,
        async searchPersonOrg(input) {
          await world.hold();
          if (input.kind !== "by-name") throw new Error("the scripted Emergency Contact run looks people up by name");
          const eid = Object.keys(EC_PEOPLE).find(candidate => EC_PEOPLE[candidate] === input.name);
          if (eid === undefined) throw new Error(`the scripted UCPath knows no ${input.name}`);
          const candidate = { emplId: eid, name: input.name, department: "Housing Dining Hospitality", jobTitle: "Fixture employee", employeeStatus: "active" as const, hdh: true,
            hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
          return SearchPersonOrgOutputSchema.parse({ results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [eid] } });
        },
        readEmergencyContacts: async input => { await world.hold(); return forSubject(input).readEmergencyContacts(input); },
        stageEmergencyContact: async (input, plan) => { await world.hold(); return forSubject(input).stageEmergencyContact(input, plan); },
        saveEmergencyContact: async (input, capability) => {
          const run = world.run();
          // Recorded when asked, before the fake answers: a second Save for the same run shows as a second entry even if it is refused.
          world.record({ runId: run.runId, nodeId: run.heldNode(), eid: input.emplId });
          const saved = await forSubject(input).saveEmergencyContact(input, capability);
          if (run.loseAnswer()) throw new Error("the Save answer was not observed");
          return saved;
        },
        read: id => active === undefined ? base.read(id) : active.driver.read(id),
      };
    } };
  },
};

/** The people an I-9 Check Start PDF holds, one PDF each: their employee ID, the name on the form and the first name that tells the review which ID to assert. */
export const I9_PEOPLE = Object.freeze([
  { eid: "10000001", name: "Example, Avery", firstName: "Avery" },
  { eid: "10000002", name: "Example, Blair", firstName: "Blair" },
] as const);

/**
 * I-9 Check Start: one PDF per person, each read by an OCR child (entered manually, so no provider is asked) and reviewed by the operator,
 * then one person check per approved person against UCPath, then one results workbook. The subject is a comma list of employee IDs.
 */
export const I9_CHECK_START_SCRIPT: ScriptedWorkflow = {
  module: catalogModule("i9-check-start"),
  children: ["ocr", "ocr-page", "person-lookup", "i9-lookup", "i9-check"].map(childModule),
  writeNode: "save-workbook",
  submission: () => { throw new Error("an I-9 Check Start run is started with its uploaded PDFs: use the executor's submission()"); },
  subjectOf: () => "",
  assertedEid: answers => I9_PEOPLE.find(person => person.firstName === answers["firstName"])?.eid,
  async prepare(world, subject) {
    const people = subject.split(",").map(eid => I9_PEOPLE.find(person => person.eid === eid));
    const documents = [];
    const actorId = "local-operator";
    for (const [index, person] of people.entries()) {
      if (person === undefined) throw new Error(`the scripted I-9 Check Start PDFs know no person for ${subject}`);
      const document = await world.uploadPdf(new TextEncoder().encode(`%PDF-1.7\nSynthetic I-9 ${person.eid}\n%%EOF`));
      const image = await world.putImage(PNG_PAGE);
      const rendered = { pageCount: 2, pages: [{ sourcePage: 1, image }, { sourcePage: 2, image }] };
      pagesOf(world).set(document.sha256, rendered);
      const readingId = randomUUID();
      const facts = [{ eid: person.eid, firstName: person.firstName, kind: "i9-section1" as const, dob: "01/15/2000" },
        { eid: person.eid, firstName: person.firstName, kind: "i9-section2" as const, hireDate: "06/01/2020" }];
      const assertions = ocrPageInputs(buildOcrSourceManifest(document, rendered), readingId, "i9").map((page, pageIndex) => {
        const fact = facts[pageIndex];
        if (fact === undefined) throw new Error("the scripted I-9 PDF has two pages");
        const reading = bindManualOcrPageReading(page, actorId, { ...i9PageSubmission(page, fact), source: { kind: "operator", actorId } });
        return { sourcePage: reading.input.sourcePage, extraction: reading.extraction };
      });
      documents.push({ document, fileName: `source-${String(index)}.pdf`, readingId, reading: { kind: "manual" as const, actorId, assertions } });
    }
    return I9CheckStartInput.parse({ documents, asOf: "2026-11-01", reviewerName: "Example Reviewer" });
  },
  stores: world => EMERGENCY_CONTACT_SCRIPT.stores?.(world) ?? [],
  drivers(world) {
    const candidates = I9_PEOPLE.map(person => ({ ...i9Candidate, emplId: EidSchema.parse(person.eid), name: person.name, startDate: "06/01/2020" }));
    const now = () => world.clock.now().toISOString();
    return { crm: () => healthyCrmDriver(), i9: () => createDeterministicI9Driver({ lookup: { i9Status: "not-found", signerName: "" }, now: now() }),
      ucpath: (): UcpathPersonOrgDriver => ({ ...createDeterministicUcpathPersonOrgDriver(),
        async searchPersonOrg(input) {
          await world.hold();
          return i9Search(candidates.filter(candidate => input.kind === "by-name" ? candidate.name === input.name : candidate.emplId === input.emplId));
        },
        async searchPersonMatch(input) {
          await world.hold();
          const confirmed = candidates.filter(candidate => candidate.name === `${input.lastName}, ${input.firstName}`).map(candidate => ({ emplId: candidate.emplId, name: candidate.name }));
          return { hits: confirmed, confirmed, dropped: [] };
        } }) };
  },
};

export const SCRIPTED_WORKFLOWS: readonly ScriptedWorkflow[] = Object.freeze([WORK_STUDY_SCRIPT, PERSON_LOOKUP_SCRIPT, CRM_DOC_DOWNLOAD_SCRIPT, EMERGENCY_CONTACT_SCRIPT, I9_CHECK_START_SCRIPT]);

export function scriptedWorkflow(workflowId: string): ScriptedWorkflow {
  const script = SCRIPTED_WORKFLOWS.find(candidate => candidate.module.descriptor.id === workflowId);
  if (script === undefined) throw new Error(`no scripted workflow ${workflowId}; scripted: ${SCRIPTED_WORKFLOWS.map(candidate => candidate.module.descriptor.id).join(", ")}`);
  return script;
}

/** A scripted workflow's descriptor, or that of a child workflow one of them delegates to. */
export const scriptedDescriptorOf = (workflowId: string) => SCRIPTED_WORKFLOWS.flatMap(script => [script.module, ...(script.children ?? [])]).find(module => module.descriptor.id === workflowId)?.descriptor;
