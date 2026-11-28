import { z } from "zod";
import { encodeEditableWorkbook, WorkbookMetadataSchema } from "../../models/dashboard/workbooks.js";
import type { WorkbookLibraryChangeSchema, WorkbookLibraryEntry } from "../../models/dashboard/workbook-library.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../rules/validation/canonical-json.js";
import { WorkbookLibraryError } from "../workbooks/workbook-library-error.js";
import type { AssistantEditDetails } from "../storage/sqlite/assistant-applied-edits.js";
import { editValueSpellings, operatorEditSource, requireEditRead, requireOperatorEdit, requireOperatorSource } from "./applied-edits.js";
import { AssistantChangeOutput, AssistantToolRefusal, referenceSchema, type AssistantChangeContext, type AssistantChangeTool, type AssistantToolContext } from "./plugins/plugin.js";
import type { AssistantPluginDeps } from "./plugins/registry.js";

const Sheet = referenceSchema("S"), Version = referenceSchema("V"), Text = z.string().min(1).max(320);
const Position = z.number().int().positive();
const Parameters = z.strictObject({ change: z.union([
  z.strictObject({ action: z.literal("rename"), sheet: Sheet, source: Text.nullable() }),
  z.strictObject({ action: z.literal("set-type"), sheet: Sheet, type: referenceSchema("T") }),
  z.strictObject({ action: z.literal("link"), sheet: Sheet, source: Text.nullable() }),
  z.strictObject({ action: z.literal("unlink"), sheet: Sheet }),
  z.strictObject({ action: z.literal("new-version"), sheet: Sheet, file: referenceSchema("A") }),
  z.strictObject({ action: z.literal("create-version"), sheet: Sheet, version: Version, source: Text.nullable() }),
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
  requireEditRead(context, `workbook-version:${entry.libraryId}:${version.id}`, workbookEditRevision(entry));
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

/** Parses an authenticated attachment locally. Read tools disclose only its shape. */
export async function attachmentWorkbook(deps: Pick<AssistantPluginDeps, "attachment">, context: AssistantToolContext, file: string) {
  const record = deps.attachment(context.conversationId, context.references.resolve(file, ["A"]).target);
  if (record === undefined) throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNAVAILABLE");
  if (record.mediaType !== "text/csv" && record.mediaType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNSUPPORTED");
  const { importWorkbook } = await import("../../rules/spreadsheets/workbook-io.js");
  const workbook = await importWorkbook(record.name, new Uint8Array(record.bytes).buffer)
    .catch(() => { throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_INVALID"); });
  context.assertCurrent();
  return { id: record.id, sha256: record.sha256, workbook };
}

export function spreadsheetChange(deps: Pick<AssistantPluginDeps, "workbooks" | "attachment">, edits: NonNullable<AssistantPluginDeps["edits"]>): AssistantChangeTool {
  return {
    kind: "change", tier: "write-local", name: "change_spreadsheet",
    description: "Edit a local library workbook after reading it. Rename, set type, link or unlink SharePoint, use or rename a version, create a named version from a saved one, save an attachment as the next version, or change one cell. "
      + 'Require a direct command naming the only spreadsheet or spreadsheet "Name" and its value. Use 1-based worksheet, row and column. Pass the decoded value as source. URLs ending a sentence with a period need quotes.',
    parameters: Parameters, output: AssistantChangeOutput, privacy: [],
    async change(input, context) {
      const { change } = Parameters.parse(input);
      const sourceText = "source" in change ? requireOperatorSource(context, change.source) : undefined;
      const library = deps.workbooks(), libraryId = context.references.resolve(change.sheet, ["S"]).target;
      const attachment = change.action === "new-version" ? await attachmentWorkbook(deps, context, change.file) : undefined;
      return () => {
        try {
          return edits.apply(context, owner => {
            const catalog = library.catalog().filter(row => !row.state.removed);
            const entry = catalog.find(row => row.libraryId === libraryId);
            if (entry === undefined || entry.state.origin.kind !== "local") throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
            requireEditRead(context, `workbook:${libraryId}`, workbookEditRevision(entry));
            const targets = catalog.length === 1 ? ["the spreadsheet", "the only spreadsheet"] : [];
            if (catalog.every(row => row === entry || row.name !== entry.name)) targets.push(`spreadsheet ${JSON.stringify(entry.name)}`);
            const requireRequest = (commands: (target: string) => readonly string[]) => requireOperatorEdit(context, targets.flatMap(commands));
            const versionName = (name: string) => {
              if (entry.state.versions.filter(row => row.name === name).length !== 1) throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
              return JSON.stringify(name);
            };
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
                requireRequest(target => editValueSpellings(name).map(value => `rename ${target} to ${value}`));
                return local({ kind: "rename", name }, "Renamed the spreadsheet", entry.name, name, entry.name, name);
              }
              case "set-type": {
                const typeId = context.references.resolve(change.type, ["T"]).target, types = library.types();
                const type = types.find(row => row.id === typeId);
                if (type === undefined) throw new AssistantToolRefusal("ASSISTANT_EDIT_STALE");
                if (types.filter(row => row.name === type.name).length !== 1) throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
                requireRequest(target => [`set the type of ${target} to ${JSON.stringify(type.name)}`]);
                const metadata = WorkbookMetadataSchema.parse({ ...entry.metadata, typeId });
                return local({ kind: "metadata", metadata }, `Changed the type of ${entry.name}`,
                  entry.metadata, metadata, entry.type.name, type.name);
              }
              case "link": {
                const url = text(), metadata = WorkbookMetadataSchema.safeParse({ ...entry.metadata, sharePoint: { url, verifiedAt: owner.at } });
                const spellings = [JSON.stringify(url)];
                if (!/[\s"]/u.test(url) && !context.operatorText.trimEnd().endsWith(".")) spellings.push(url);
                requireRequest(target => spellings.map(value => `link ${target} to ${value}`));
                if (!metadata.success) throw new AssistantToolRefusal("ASSISTANT_SPREADSHEET_REFUSED");
                return local({ kind: "link", url }, `Changed the link for ${entry.name}`, entry.metadata, metadata.data,
                  entry.metadata.sharePoint === null ? "Unlinked" : entry.metadata.sharePoint.url, url);
              }
              case "unlink": {
                requireRequest(target => [`unlink ${target}`]);
                const metadata = { ...entry.metadata, sharePoint: null };
                return local({ kind: "metadata", metadata }, `Changed the link for ${entry.name}`, entry.metadata, metadata, "Linked", "Unlinked");
              }
              case "create-version": {
                const source = namedVersion(context, entry, change.version), name = text();
                const from = versionName(source.name);
                requireRequest(target => editValueSpellings(name).map(value => `create version ${value} of ${target} from version ${from}`));
                return local({ kind: "create-version", name, from: { kind: "version", versionId: source.id }, useNow: false },
                  `Named a version of ${entry.name}`, null, { id: owner.id, name, sourceVersionId: source.id }, "Unnamed", name,
                  { kind: "version", versionId: owner.id });
              }
              case "new-version": {
                const current = attachment === undefined ? undefined : deps.attachment(context.conversationId, attachment.id);
                if (attachment === undefined || current === undefined || current.sha256 !== attachment.sha256) {
                  throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNAVAILABLE");
                }
                const files = context.references.issued().filter(([, ref]) => ref.kind === "A" && deps.attachment(context.conversationId, ref.target)?.name === current.name);
                if (files.length !== 1) throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
                requireRequest(target => [`save attachment ${JSON.stringify(current.name)} as a new version of ${target}`]);
                const workbook = encodeEditableWorkbook({ ...attachment.workbook, name: entry.name, libraryId });
                const saved = edits.workbooks().operatorOperation(libraryId, owner.id, { kind: "save", expectedVersion: entry.version, workbook });
                if (saved.state !== "applied") throw new AssistantToolRefusal("ASSISTANT_SPREADSHEET_REFUSED");
                const ownerRevision = revision();
                if (ownerRevision.version !== saved.version) throw new Error("assistant-edit-workbook-version-mismatch");
                return { details: { kind: "spreadsheets", libraryId, command: "save", ownerRevision,
                  prior: entry.version, next: saved.version, location: { kind: "workbook" },
                  attachment: { id: attachment.id, sha256: attachment.sha256 } },
                  label: `Changed the saved revision of ${entry.name}`, before: String(entry.version), after: String(saved.version) };
              }
              case "rename-version": {
                const version = namedVersion(context, entry, change.version), name = text();
                const prior = versionName(version.name);
                requireRequest(target => editValueSpellings(name).map(value => `rename version ${prior} of ${target} to ${value}`));
                return local({ kind: "rename-version", versionId: version.id, name }, `Renamed a version of ${entry.name}`,
                  version.name, name, version.name, name, { kind: "version", versionId: version.id });
              }
              case "use-version": {
                const version = namedVersion(context, entry, change.version);
                const name = versionName(version.name);
                requireRequest(target => [`use version ${name} of ${target}`]);
                const selected = entry.state.versions.find(row => row.id === entry.state.selectedVersionId);
                if (selected === undefined) throw new Error("assistant-edit-workbook-selected-version-missing");
                return local({ kind: "use-version", versionId: version.id }, `Changed the version of ${entry.name}`,
                  selected.id, version.id, selected.name, version.name);
              }
              case "set-cell": {
                const source = text();
                const next = cellValue(change.format, source);
                const values = change.format !== "text" ? [source]
                  : /^(?:[-+.\d]|true$|false$|clear$|blank$|empty$)/iu.test(source) ? [JSON.stringify(source)] : editValueSpellings(source);
                requireRequest(target => {
                  const cell = `${target} worksheet ${String(change.worksheet)}, row ${String(change.row)}, column ${String(change.column)}`;
                  if (change.format === "blank" && /^clear$/iu.test(source)) return [`clear ${cell}`];
                  return values.map(value => `set ${cell} to ${value}`);
                });
                const workbook = encodeEditableWorkbook(library.read(libraryId).workbook), sheet = workbook.sheets[change.worksheet - 1];
                const row = sheet?.rows[change.row - 1], cell = row?.cells[change.column - 1];
                if (sheet === undefined || row === undefined || cell === undefined || change.row <= (sheet.headerRow ?? 1)
                  || cell.richText !== undefined || cell.hyperlink !== undefined) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
                const prior = JsonValueSchema.parse(cell.value);
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
      };
    },
  };
}
