import { z } from "zod";
import { encodeEditableWorkbook, WorkbookMetadataSchema } from "../../models/dashboard/workbooks.js";
import type { WorkbookLibraryChangeSchema, WorkbookLibraryEntry } from "../../models/dashboard/workbook-library.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../rules/validation/canonical-json.js";
import { WorkbookLibraryError } from "../workbooks/workbook-library-error.js";
import type { AssistantEditDetails } from "../storage/sqlite/assistant-applied-edits.js";
import { operatorEditSource, requireEditRead, requireOperatorSource } from "./applied-edits.js";
import { AssistantChangeOutput, AssistantToolRefusal, referenceSchema, type AssistantChangeContext, type AssistantChangeTool } from "./plugins/plugin.js";
import type { AssistantPluginDeps } from "./plugins/registry.js";

const Sheet = referenceSchema("S"), Version = referenceSchema("V"), Text = z.string().min(1).max(320);
const Position = z.number().int().positive();
const Parameters = z.strictObject({ change: z.union([
  z.strictObject({ action: z.literal("rename"), sheet: Sheet, source: Text.nullable() }),
  z.strictObject({ action: z.literal("set-type"), sheet: Sheet, type: referenceSchema("T") }),
  z.strictObject({ action: z.literal("unlink"), sheet: Sheet }),
  z.strictObject({ action: z.literal("use-version"), sheet: Sheet, version: Version }),
  z.strictObject({ action: z.literal("rename-version"), sheet: Sheet, version: Version, source: Text.nullable() }),
  z.strictObject({ action: z.literal("set-cell"), sheet: Sheet, worksheet: Position, row: Position, column: Position,
    format: z.enum(["text", "number", "boolean", "blank"]), source: Text.nullable() }),
]) });
type WorkbookEdit = Extract<AssistantEditDetails, { kind: "spreadsheets" }>;
type LocalChange = Extract<z.infer<typeof WorkbookLibraryChangeSchema>, { kind: WorkbookEdit["command"] }>;

export const workbookEditRevision = (entry: WorkbookLibraryEntry) => `${String(entry.version)}:${String(entry.state.revision)}`;

function namedVersion(context: AssistantChangeContext, entry: WorkbookLibraryEntry, token: string) {
  const id = context.references.resolve(token, ["V"]).target;
  const version = entry.state.versions.find(row => `${entry.libraryId}:${row.id}` === id);
  if (version === undefined) throw new AssistantToolRefusal("ASSISTANT_EDIT_STALE");
  return version;
}

function cellValue(format: "text" | "number" | "boolean" | "blank", source: string) {
  if (format === "text") return source;
  if (format === "number" && /^-?(?:\d+\.?\d*|\.\d+)$/u.test(source) && Number.isFinite(Number(source))) return Number(source);
  if (format === "boolean" && /^(?:true|false)$/iu.test(source)) return source.toLowerCase() === "true";
  if (format === "blank" && /^(?:clear|blank|empty)$/iu.test(source)) return null;
  throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
}

function display(value: JsonValue): string {
  return value === null || value === "" ? "Blank" : typeof value === "string" ? value
    : typeof value === "object" && "type" in value && value.type === "date" && "value" in value && typeof value.value === "string" ? value.value : canonicalJsonStringify(value);
}

export function spreadsheetChange(deps: Pick<AssistantPluginDeps, "workbooks">, edits: NonNullable<AssistantPluginDeps["edits"]>): AssistantChangeTool {
  return {
    kind: "change", tier: "write-local", name: "change_spreadsheet",
    description: "Edit a local library workbook after reading it. Rename, set type, unlink, use or rename a version, or change one cell. "
      + "Cell coordinates are 1-based and include header rows. For names and cells pass exact operator text as source or null if missing.",
    parameters: Parameters, output: AssistantChangeOutput, privacy: [],
    async change(input, context) {
      const { change } = Parameters.parse(input);
      const sourceText = "source" in change ? requireOperatorSource(context, change.source) : undefined;
      const library = deps.workbooks(), libraryId = context.references.resolve(change.sheet, ["S"]).target;
      try {
        return edits.apply(context, owner => {
          const entry = library.catalog().find(row => row.libraryId === libraryId);
          if (entry === undefined || entry.state.removed || entry.state.origin.kind !== "local") throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
          requireEditRead(context, `workbook:${libraryId}`, workbookEditRevision(entry));
          const revision = () => {
            const current = library.catalog().find(row => row.libraryId === libraryId);
            if (current === undefined || current.state.removed) throw new Error("assistant-edit-workbook-readback-missing");
            return { version: current.version, revision: current.state.revision };
          };
          const local = (command: LocalChange, label: string, prior: JsonValue, next: JsonValue, before: string, after: string,
            location: WorkbookEdit["location"] = { kind: "workbook" }) => {
            if (canonicalJsonStringify(prior) === canonicalJsonStringify(next)) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
            const applied = edits.workbooks().localLibraryAction(libraryId, { operationId: owner.id, expectedVersion: entry.version,
              expectedRevision: entry.state.revision, change: command }, owner.at);
            const ownerRevision = revision();
            if (ownerRevision.revision !== applied.result.revision) throw new Error("assistant-edit-workbook-revision-mismatch");
            return { details: { kind: "spreadsheets" as const, libraryId, location, command: command.kind, ownerRevision, prior, next },
              label, before, after, ...(sourceText === undefined ? {} : { source: operatorEditSource(context, next) }) };
          };
          const text = () => {
            if (sourceText === undefined) throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
            return sourceText;
          };
          switch (change.action) {
            case "rename": {
              const name = text();
              return local({ kind: "rename", name }, "Renamed the spreadsheet", entry.name, name, entry.name, name);
            }
            case "set-type": {
              const typeId = context.references.resolve(change.type, ["T"]).target, type = library.types().find(row => row.id === typeId);
              if (type === undefined) throw new AssistantToolRefusal("ASSISTANT_EDIT_STALE");
              const metadata = WorkbookMetadataSchema.parse({ ...entry.metadata, typeId });
              return local({ kind: "metadata", metadata }, `Changed the type of ${entry.name}`,
                entry.metadata, metadata, entry.type.name, type.name);
            }
            case "unlink": {
              const metadata = { ...entry.metadata, sharePoint: null };
              return local({ kind: "metadata", metadata }, `Changed the link for ${entry.name}`, entry.metadata, metadata, "Linked", "Unlinked");
            }
            case "rename-version": {
              const version = namedVersion(context, entry, change.version), name = text();
              return local({ kind: "rename-version", versionId: version.id, name }, `Renamed a version of ${entry.name}`,
                version.name, name, version.name, name, { kind: "version", versionId: version.id });
            }
            case "use-version": {
              const version = namedVersion(context, entry, change.version);
              const selected = entry.state.versions.find(row => row.id === entry.state.selectedVersionId);
              if (selected === undefined) throw new Error("assistant-edit-workbook-selected-version-missing");
              return local({ kind: "use-version", versionId: version.id }, `Changed the version of ${entry.name}`,
                selected.id, version.id, selected.name, version.name);
            }
            case "set-cell": {
              const workbook = encodeEditableWorkbook(library.read(libraryId).workbook), sheet = workbook.sheets[change.worksheet - 1];
              const row = sheet?.rows[change.row - 1], cell = row?.cells[change.column - 1];
              if (sheet === undefined || row === undefined || cell === undefined || change.row <= (sheet.headerRow ?? 1)
                || cell.richText !== undefined || cell.hyperlink !== undefined) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
              const prior = JsonValueSchema.parse(cell.value), next = cellValue(change.format, text());
              if (prior === next) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
              cell.value = next;
              const saved = edits.workbooks().operatorOperation(libraryId, owner.id, { kind: "save", expectedVersion: entry.version, workbook });
              if (saved.state !== "applied") throw new AssistantToolRefusal("ASSISTANT_SPREADSHEET_REFUSED");
              const ownerRevision = revision();
              if (ownerRevision.version !== saved.version) throw new Error("assistant-edit-workbook-version-mismatch");
              return { details: { kind: "spreadsheets", libraryId, command: "save", ownerRevision, prior, next,
                location: { kind: "cell", sheetId: sheet.id, rowId: row.id, column: change.column - 1 } },
                label: `Changed ${entry.name}, worksheet ${String(change.worksheet)}, row ${String(change.row)}, column ${String(change.column)}`,
                before: display(prior), after: display(next), source: operatorEditSource(context, next) };
            }
          }
        });
      } catch (error) {
        if (error instanceof WorkbookLibraryError) throw new AssistantToolRefusal(error.code === "WORKBOOK_VERSION_CONFLICT"
          ? "ASSISTANT_EDIT_STALE" : "ASSISTANT_SPREADSHEET_REFUSED");
        throw error;
      }
    },
  };
}
