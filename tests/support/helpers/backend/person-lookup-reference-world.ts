import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SERVER_REGISTRY } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createWorkbookLibraryAdapter } from "../../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import type { WorkbookActiveSelectionSchema } from "../../../../src/models/dashboard/workbook-library.js";
import { REFERENCE_CHECK_ID } from "../../../../src/models/processing/workbooks/reference-fields.js";
import type { StepOmissions } from "../../../../src/models/workflow/step-omission.js";
import type { UcpathPersonOrgDriver } from "../../../../src/models/ui/ucpath-person-org.js";
import { UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { i9Search } from "../../fixtures/i9-check.js";
import { PREFERENCES_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../src/backend/systems/crm/driver/fake.js";
import { ReadOnboardingDatesOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-dates.js";
import { CrmDiscoveredRecordSchema } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { personLookupModule } from "../registered-workflows.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";

/** The one person UCPath holds in this world. */
export const REFERENCE_PERSON = UcpathCandidateSchema.parse({ emplId: "10000001", name: "Example, Avery", department: "Housing Dining Hospitality", jobTitle: "Assistant",
  employeeStatus: "active", hdh: true, hrStatus: "Active", startDate: "06/15/2026", effectiveDate: "07/01/2026", terminationDate: "", terminationReason: "" });

const CRM_RECORD = CrmDiscoveredRecordSchema.parse({ recordId: "ONB-1", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=ONB-1", emplId: REFERENCE_PERSON.emplId,
  name: REFERENCE_PERSON.name, department: REFERENCE_PERSON.department, firstDayOfService: "07/01/2026", dateSigned: "06/25/2026" });

/** Runs Person Lookup through the real start plan, start command and executor against real library spreadsheets. */
export function createPersonLookupReferenceWorld() {
  const world = createRunExecutorTestWorld();
  return { cleanup: world.cleanup, async fixture() {
    /** Every CRM onboarding search this world served; a search finds the record under its Employee ID, else under its name. */
    const crmQueries: Readonly<{ name?: string; eid?: string }>[] = [];
    const sessions = sessionFactoryHarness({ crm: () => ({ ...createDeterministicCrmOnboardingDriver({ discovery: [CRM_RECORD],
      record: { state: "found", record: { recordId: CRM_RECORD.recordId, emplId: CRM_RECORD.emplId, fullName: CRM_RECORD.name, rawStage: "Completed" } },
      dates: ReadOnboardingDatesOutputSchema.parse({ emplId: REFERENCE_PERSON.emplId, state: "read", employmentDate: "2026-07-01", oathDate: "2026-06-25", reason: "" }) }),
      async searchOnboardingRecords(query: Readonly<{ name?: string; eid?: string }>) {
        crmQueries.push(query);
        return [CRM_RECORD].filter(record => query.eid === undefined ? record.name === query.name : record.emplId === query.eid);
      } }), ucpath: (): UcpathPersonOrgDriver => ({ ...createDeterministicUcpathPersonOrgDriver(),
      async searchPersonOrg(input) { return i9Search([REFERENCE_PERSON].filter(person => input.kind === "by-name" ? person.name === input.name : person.emplId === input.emplId)); },
      async searchPersonMatch(input) {
        const confirmed = [REFERENCE_PERSON].filter(person => person.name === `${input.lastName}, ${input.firstName}`).map(({ emplId, name }) => ({ emplId, name }));
        return { hits: confirmed, confirmed, dropped: [] };
      },
    }) });
    const { descriptor } = personLookupModule, harness = await world.executorHarness({ descriptor, sessions });
    const { database, path, clock } = harness.authority, admission = boundProfileAdmission(path);
    const settings = readSettings(database.authority), resolved = resolveConfigWithProvenance(settings.settings, hostConfigFacts({}), clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
    const snapshot = ConfigSnapshotRecordSchema.parse({ ...PREFERENCES_SNAPSHOT, configSnapshotId: randomUUID(), revision: settings.revision,
      fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
    database.authority.configSnapshots.insert(snapshot);
    database.authority.runtimeConfig.activate({ settingsRevision: settings.revision, settingsFingerprint: settings.settingsFingerprint,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: snapshot.capturedAt });
    const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
    const runWorkbooks = createRunWorkbookService({ database, clock });
    const canonical = canonicalChildExecution({ ...harness.deps, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }) }, database, path, id => SERVER_REGISTRY[id]?.descriptor, undefined, { workbooks: library,
      resources: (_reader, run) => ({ providers: { configSnapshots: database.authority.configSnapshots, idFactory: { next: randomUUID },
        adapters: { "workbooks.library": createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId: run.envelope.runId, clock,
          references: { runId: run.envelope.runId, write: () => { throw new Error("Person Lookup must not write a reference"); },
            readFields: command => runWorkbooks.readReferenceFields(run, command) } }) } } }) });
    /** Saves one library spreadsheet; `rows` follow the header row, so the first data row is sheet row 2. */
    const spreadsheet = (name: string, sheetName: string, fields: readonly string[], rows: readonly (readonly (string | number)[])[]): z.infer<typeof WorkbookActiveSelectionSchema> => {
      const saved = library.create({ name, themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: sheetName, width: fields.length, hidden: [], headerRow: 1,
        columnBindings: fields.map((fieldId, index) => ({ id: `column-${String(index)}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
        rows: [{ id: "header", cells: fields.map(value => ({ value })) }, ...rows.map((cells, index) => ({ id: `row-${String(index)}`, cells: cells.map(value => ({ value })) }))] }] });
      return { entry: 1, typeId: REFERENCE_CHECK_ID, libraryId: saved.libraryId, versionId: library.libraryVersion(saved.libraryId).version.id,
        sheetId: "sheet", expectedVersion: library.read(saved.libraryId).version };
    };
    const run = async (input: unknown, picks: readonly z.infer<typeof WorkbookActiveSelectionSchema>[], selectedStepKeys?: readonly string[], stepOmissions?: StepOmissions) => {
      const started = canonical.start(descriptor, input, { dryRun: false, ...(picks.length === 0 ? {} : { workbookReferences: picks }),
        ...(selectedStepKeys === undefined ? {} : { selectedStepKeys }), ...(stepOmissions === undefined ? {} : { stepOmissions }) });
      const { run: settled, outcomes } = await canonical.execute(started, new AbortController().signal);
      assert.ok(settled);
      const events = database.authority.timelineEvents.page({}).filter(event => event.scope.kind === "run" && event.scope.runId === started.envelope.runId);
      return { run: settled, outcomes, events };
    };
    return { harness, database, descriptor, spreadsheet, run, canonical, crmQueries };
  } };
}
