/** Spreadsheets fixtures for the state gallery: an in-page library server that answers the workbook reads and the library actions, so the
 * real page, adapter and wire validation run unchanged. The library lives in memory and each action changes it the way the backend does:
 * one revision up, the new state returned as the action's result. Browser-safe. */
import { DateOnlySchema, IsoInstantSchema, RunIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { WorkbookCloneRequestSchema, WorkbookLibraryActionSchema, projectWorkbookCompatibility, type WorkbookLibraryAction, type WorkbookLibraryEntry,
  type WorkbookLibraryState, type WorkbookLibraryVersion, type WorkbookLibrarySyncStatus, type WorkflowWorkbookRequirementInput } from "../../../../src/models/dashboard/workbook-library.js";
import { decodeEditableWorkbook, encodeEditableWorkbook, type EditableWorkbookWire, type WorkbookSummary, type WorkbookType } from "../../../../src/models/dashboard/workbooks.js";
import { copyColumnMapping } from "../../../../src/rules/spreadsheets/column-mapping.js";

const BASE_URL = "http://relay.story.test";
const SHAREPOINT_URL = "https://tenant.sharepoint.com/sites/people/Shared%20Documents/Roster.xlsx";
const at = (day: number) => IsoInstantSchema.parse(`2026-09-${String(day).padStart(2, "0")}T09:00:00.000Z`);

export type SheetsCatalogRead = "answer" | "never" | "fail" | "fail-once";
export type SheetsOpenRead = "answer" | "never" | "fail";
/** What the page's next library action comes back as. `lost` is a change whose answer never reached the page and is not on record. */
export type SheetsAction = "applied" | "refused" | "lost";
export type SheetsSave = "applied" | "refused";
export type SheetsSeed = "mixed" | "few" | "none" | "no-match";

export interface SheetsStoryServerOptions {
  readonly seed?: SheetsSeed;
  readonly catalog?: SheetsCatalogRead;
  readonly open?: SheetsOpenRead;
  readonly action?: SheetsAction;
  /** A sync, whatever `action` says, that the library could not complete. */
  readonly sync?: "fail";
  readonly save?: SheetsSave;
  /** A clone or a SharePoint import the library refuses. */
  readonly add?: "refused";
}

export interface SheetsStoryServer {
  readonly client: DashboardClient;
  /** Every library action the page sent. */
  readonly actions: readonly WorkbookLibraryAction[];
}

interface Seed {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
  readonly pinned?: boolean;
  readonly sharePoint?: boolean;
  readonly mapped?: boolean;
  /** Worksheets with the same headers; only the first is mapped. */
  readonly sheets?: number;
  readonly versions?: number;
  readonly rows?: number;
  readonly sync?: WorkbookLibrarySyncStatus;
  readonly workflow?: { readonly id: string; readonly label: string };
}

const EMPLOYEE_IDS = ["10000001", "10000002", "10000003", "10000004", "10000000"] as const;
const HEADERS = ["Employee ID", "Name", "Notes"] as const;
const FIELDS = ["eid", "fullName", null] as const;
const TYPE: WorkbookType = { id: "local", name: "Local", keyFieldId: null, fields: [], defaultWorkbookId: null };
const WORKFLOWS: readonly WorkflowWorkbookRequirementInput[] = [{ id: "person-lookup", label: "Person Lookup", requiredWorkbookFields: ["eid"],
  workbookReference: { id: "roster", keyFieldId: "eid", mode: "keys", writableFields: [] } }];

function workbookOf(seed: Seed, version: number): EditableWorkbookWire {
  const rows = seed.rows ?? 4;
  return { name: seed.name, libraryId: seed.id, themes: [], hasFormulas: false, sheets: Array.from({ length: seed.sheets ?? 1 }, (_, sheet) => ({ id: `sheet-${sheet + 1}`, name: `Sheet${sheet + 1}`, width: HEADERS.length, hidden: [], headerRow: 1,
    columnBindings: HEADERS.map((sourceHeader, column) => { const mapped = seed.mapped !== false && sheet === 0 && FIELDS[column] !== null;
      return { id: `sheet-${sheet + 1}-column-${column}`, sourceColumn: column, sourceHeader, fieldId: mapped ? FIELDS[column] : null, basis: mapped ? "header" as const : "unmapped" as const }; }),
    rows: [{ id: "header", cells: HEADERS.map(value => ({ value })) },
      ...Array.from({ length: rows }, (_, row) => ({ id: `row-${row}`, cells: [{ value: EMPLOYEE_IDS[(row + version) % EMPLOYEE_IDS.length] ?? "" }, { value: `Sample, Person ${row + 1}` }, { value: row % 2 === 0 ? "Active" : "" }] }))] })) };
}

interface Library { entry: WorkbookLibraryEntry; workbooks: Map<string, EditableWorkbookWire> }

function libraryOf(seed: Seed, index: number): Library {
  const count = seed.versions ?? 1;
  const versions: WorkbookLibraryVersion[] = Array.from({ length: count }, (_, number) => ({ id: `${seed.id}-v${number + 1}`, name: number === 0 ? "Original" : `Version ${number + 1}`, version: number + 1,
    snapshotId: `${seed.id}-s${number + 1}`, savedAt: at(index + 1 + number), source: number === 0 ? "import" : "operator" }));
  const selected = versions[count - 1];
  const origin: WorkbookLibraryState["origin"] = seed.workflow === undefined ? { kind: "local" }
    : { kind: "workflow" as const, runId: RunIdSchema.parse("7d1f4c2e-5a3b-4e6d-8f90-1a2b3c4d5e6f"), partitionDay: DateOnlySchema.parse("2026-09-20"), workflowId: WorkflowIdSchema.parse(seed.workflow.id), workflowLabel: seed.workflow.label, rowCount: seed.rows ?? 4, rowSubject: "person" };
  const state: WorkbookLibraryState = { libraryId: seed.id, revision: 1, selectedVersionId: selected.id, origin, removed: false, pinned: seed.pinned ?? false, tags: [...seed.tags ?? []], versions };
  const entry: WorkbookLibraryEntry = { libraryId: seed.id, version: selected.version, name: seed.name, updatedAt: selected.savedAt, worksheets: [{ id: "sheet-1", name: "Sheet1" }],
    rowCount: seed.rows ?? 4, metadata: { typeId: TYPE.id, sharePoint: seed.sharePoint === true ? { url: SHAREPOINT_URL, verifiedAt: at(index + 1) } : null }, type: TYPE, state,
    ...(seed.sync === undefined ? {} : { sync: seed.sync }) };
  return { entry, workbooks: new Map(versions.map(version => [version.id, workbookOf(seed, version.version)])) };
}

const FAILED_SYNC: WorkbookLibrarySyncStatus = { state: "idle", lastFinishedAt: at(18), lastResult: "failed", lastFailureCode: "WORKBOOK_SYNC_IMPORT_FAILED" };
const SEEDS: Readonly<Record<SheetsSeed, readonly Seed[]>> = {
  mixed: [
    { id: "roster", name: "Department roster.xlsx", pinned: true, sharePoint: true, versions: 3, tags: ["HR"] },
    { id: "linked", name: "Hiring tracker.xlsx", sharePoint: true, sync: FAILED_SYNC, tags: ["Hiring"] },
    { id: "plain", name: "Onboarding list.xlsx", tags: ["HR", "Onboarding"], sheets: 3 },
    { id: "unmapped", name: "Imported contacts.xlsx", mapped: false, rows: 2 },
    { id: "output", name: "Person Lookup results.xlsx", workflow: { id: "person-lookup", label: "Person Lookup" }, rows: 6 },
  ],
  few: [{ id: "plain", name: "Onboarding list.xlsx" }],
  none: [],
  "no-match": [{ id: "plain", name: "Onboarding list.xlsx" }],
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (code: string, message: string, status = 422): Response => json({ state: "error", code, message, retryable: false }, status);
const never = (): Promise<Response> => new Promise<Response>(() => undefined);

export function sheetsStoryServer(options: SheetsStoryServerOptions = {}): SheetsStoryServer {
  const { seed = "mixed", catalog = "answer", open = "answer", action = "applied", save = "applied" } = options;
  const libraries = new Map<string, Library>(SEEDS[seed].map((item, index) => [item.id, libraryOf(item, index)]));
  const actions: WorkbookLibraryAction[] = [];
  let catalogReads = 0;
  let created = 0;

  const entries = (): WorkbookLibraryEntry[] => [...libraries.values()].map(library => library.entry);
  const compatibility = () => projectWorkbookCompatibility(WORKFLOWS, entries().map(entry => ({ libraryId: entry.libraryId, versionId: entry.state.selectedVersionId,
    origin: entry.state.origin, removed: entry.state.removed,
    sheets: libraries.get(entry.libraryId)!.workbooks.get(entry.state.selectedVersionId)!.sheets.map(sheet => ({ id: sheet.id, name: sheet.name,
      mappings: (sheet.columnBindings ?? []).flatMap(binding => binding.fieldId === null || binding.basis === "unmapped" || binding.sourceColumn === null ? []
        : [{ fieldId: binding.fieldId, column: binding.sourceColumn, basis: binding.basis }]) })) })));
  const saved = (library: Library) => { const { entry } = library; const workbook = library.workbooks.get(entry.state.selectedVersionId)!;
    return { libraryId: entry.libraryId, version: entry.version, createdAt: entry.state.versions[0].savedAt, savedAt: entry.updatedAt, workbook }; };
  const summary = (library: Library): WorkbookSummary => { const record = saved(library);
    return { libraryId: record.libraryId, name: library.entry.name, typeId: TYPE.id, version: record.version, createdAt: record.createdAt, savedAt: record.savedAt, rowCount: library.entry.rowCount,
      sheets: record.workbook.sheets.map(sheet => ({ name: sheet.name, headerRow: sheet.headerRow ?? 1, columns: [...HEADERS], ...(sheet.columnBindings === undefined ? {} : { columnBindings: sheet.columnBindings }) })) }; };

  const addLibrary = (name: string, from?: Library): Library => {
    created += 1;
    const id = `added-${created}`;
    const library = libraryOf({ id, name, rows: from?.entry.rowCount ?? 4 }, 20 + created);
    libraries.set(id, library);
    return library;
  };

  const apply = (library: Library, change: WorkbookLibraryAction["change"], request: WorkbookLibraryAction): WorkbookLibraryState => {
    const { entry } = library;
    const state: WorkbookLibraryState = { ...entry.state, revision: request.expectedRevision + 1 };
    let next: WorkbookLibraryEntry = { ...entry, state };
    switch (change.kind) {
      case "pin": case "unpin": next = { ...next, state: { ...state, pinned: change.kind === "pin" } }; break;
      case "set-tags": next = { ...next, state: { ...state, tags: [...change.tags] } }; break;
      case "rename": next = { ...next, name: change.name }; break;
      case "link": next = { ...next, metadata: { ...entry.metadata, sharePoint: { url: change.url, verifiedAt: at(21) } } }; break;
      case "unlink": { const { sync: _sync, ...rest } = next; next = { ...rest, metadata: { ...entry.metadata, sharePoint: null } }; break; }
      case "use-version": { const version = state.versions.find(item => item.id === change.versionId)!; next = { ...next, version: version.version, updatedAt: version.savedAt, state: { ...state, selectedVersionId: version.id } }; break; }
      case "sync": next = { ...next, sync: { state: "idle", lastFinishedAt: at(22), lastResult: "ok" } }; break;
      case "remove": next = { ...next, state: { ...state, removed: true } }; break;
      default: break;
    }
    library.entry = next;
    if (change.kind === "remove") libraries.delete(entry.libraryId);
    return next.state;
  };

  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const { pathname } = new URL(url);
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (pathname === "/api/v1/workbooks/catalog") {
      catalogReads += 1;
      if (catalog === "never") return never();
      if (catalog === "fail" || (catalog === "fail-once" && catalogReads === 1)) return refusal("DASHBOARD_READ_FAILED", "Couldn't read the library.", 500);
      return json(entries());
    }
    if (pathname === "/api/v1/workbooks/compatibility") return catalog === "never" ? never() : json(compatibility());
    if (pathname === "/api/v1/workbooks/types") return json([TYPE]);
    if (pathname === "/api/v1/workbooks/list") return json([...libraries.values()].map(summary));
    if (pathname === "/api/v1/workbooks/import" && method === "POST") {
      const request = body as { source?: string; name?: string; url?: string };
      if (options.add === "refused") return refusal("WORKBOOK_SYNC_IMPORT_FAILED", "The downloaded file is not a supported workbook.");
      const library = addLibrary(request.name ?? "Imported.xlsx");
      return json({ workbook: saved(library) });
    }
    if (pathname === "/api/v1/workbooks" && method === "POST") {
      const { workbook } = body as { workbook: EditableWorkbookWire };
      if (options.add === "refused") return refusal("WORKBOOK_INVALID", "The library refused the spreadsheet.");
      const library = addLibrary(workbook.name);
      const first = library.entry.state.versions[0];
      library.workbooks.set(first.id, { ...workbook, libraryId: library.entry.libraryId });
      library.entry = { ...library.entry, updatedAt: first.savedAt };
      return json(saved(library));
    }
    const clone = /^\/api\/v1\/workbooks\/([^/]+)\/clone$/u.exec(pathname);
    if (clone !== null && method === "POST") {
      const source = libraries.get(decodeURIComponent(clone[1]));
      if (source === undefined || options.add === "refused") return refusal("WORKBOOK_NOT_FOUND", "That spreadsheet is no longer in the library.", 404);
      return json({ workbook: saved(addLibrary(WorkbookCloneRequestSchema.parse(body).name, source)) });
    }
    const status = /^\/api\/v1\/workbooks\/([^/]+)\/library-actions\/([^/]+)$/u.exec(pathname);
    if (status !== null) return json({ state: "absent" });
    const act = /^\/api\/v1\/workbooks\/([^/]+)\/library-actions$/u.exec(pathname);
    if (act !== null && method === "POST") {
      const library = libraries.get(decodeURIComponent(act[1]));
      const request = WorkbookLibraryActionSchema.parse(body);
      actions.push(request);
      if (library === undefined || action === "refused" || (options.sync === "fail" && request.change.kind === "sync")) return refusal("WORKBOOK_SYNC_IMPORT_FAILED", "The change was refused.");
      if (action === "lost") throw new TypeError("Failed to fetch");
      const result = apply(library, request.change, request);
      return json({ libraryId: library.entry.libraryId, at: at(23), action: request, result });
    }
    const version = /^\/api\/v1\/workbooks\/([^/]+)\/versions\/([^/]+)$/u.exec(pathname);
    if (version !== null) {
      const library = libraries.get(decodeURIComponent(version[1]));
      const record = library?.entry.state.versions.find(item => item.id === decodeURIComponent(version[2]));
      return library === undefined || record === undefined ? refusal("WORKBOOK_NOT_FOUND", "Not found.", 404) : json({ libraryId: library.entry.libraryId, version: record, workbook: library.workbooks.get(record.id) });
    }
    const write = /^\/api\/v1\/workbooks\/([^/]+)\/(save|copy-mapping)$/u.exec(pathname);
    if (write !== null && method === "POST") {
      const library = libraries.get(decodeURIComponent(write[1]));
      if (library === undefined || save === "refused") return refusal("WORKBOOK_VERSION_CONFLICT", "This spreadsheet changed elsewhere.", 409);
      const request = body as { expectedVersion: number; workbook?: EditableWorkbookWire; worksheetId?: string };
      const workbook = request.workbook ?? encodeEditableWorkbook(copyColumnMapping(decodeEditableWorkbook(saved(library).workbook), request.worksheetId ?? ""));
      const number = request.expectedVersion + 1;
      const id = `${library.entry.libraryId}-v${number}`;
      const record: WorkbookLibraryVersion = { id, name: `Version ${number}`, version: number, snapshotId: `${library.entry.libraryId}-s${number}`, savedAt: at(24), source: "operator" };
      library.workbooks.set(id, workbook);
      library.entry = { ...library.entry, version: number, updatedAt: record.savedAt, state: { ...library.entry.state, revision: library.entry.state.revision + 1, selectedVersionId: id, versions: [...library.entry.state.versions, record] } };
      return json(saved(library));
    }
    const read = /^\/api\/v1\/workbooks\/([^/]+)$/u.exec(pathname);
    if (read !== null && method === "GET") {
      if (open === "never") return never();
      const library = libraries.get(decodeURIComponent(read[1]));
      if (open === "fail" || library === undefined) return refusal("DASHBOARD_READ_FAILED", "Couldn't open the spreadsheet.", 500);
      return json(saved(library));
    }
    return json({ code: "NOT_SERVED" }, 404);
  };
  return { client: createDashboardClient({ baseUrl: BASE_URL, fetchImpl }), actions };
}
