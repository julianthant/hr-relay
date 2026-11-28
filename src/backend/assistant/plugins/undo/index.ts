import { z } from "zod";
import { SETTINGS_SCHEMA_HASH, SettingsPatchSchema, deriveRawSettingsPatchFingerprint, isRetiredSettingsPath } from "../../../../models/config/settings.js";
import type { AssistantReplyPart } from "../../../../models/dashboard/assistant.js";
import { searchPartitionDay } from "../../../../models/dashboard/search-calendar.js";
import { encodeEditableWorkbook, WorkbookCellChangeSchema, WorkbookMetadataSchema } from "../../../../models/dashboard/workbooks.js";
import { WorkbookLibraryChangeSchema, type WorkbookLibraryEntry } from "../../../../models/dashboard/workbook-library.js";
import { NotificationCommandRequestSchema, SettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { JsonValueSchema, canonicalJsonStringify, type JsonValue } from "../../../../rules/validation/canonical-json.js";
import type { AssistantAppliedEdit, AssistantEditDetails } from "../../../storage/sqlite/assistant-applied-edits.js";
import { WorkbookLibraryError } from "../../../workbooks/workbook-library-error.js";
import { observeEdit, type AssistantEditOwner } from "../../applied-edits.js";
import { operatorValueSpans } from "../../references.js";
import { AssistantChangeOutput, AssistantToolRefusal, referenceSchema, type AssistantPlugin, type AssistantToolContext } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

export interface AssistantUndoHistory {
  readonly clock: Pick<Clock, "now">;
  list(since: string): readonly AssistantAppliedEdit[];
}

type EditOwner = Parameters<Parameters<AssistantEditOwner["apply"]>[1]>[0];
type Reversal = Pick<ReturnType<Parameters<AssistantEditOwner["apply"]>[1]>, "details" | "before" | "after">;
type SheetEdit = Extract<AssistantEditDetails, { kind: "spreadsheets" }>;
type SettingEdit = Extract<AssistantEditDetails, { kind: "settings" }>;
type NoticeEdit = Extract<AssistantEditDetails, { kind: "notifications" }>;
type UndoDeps = Pick<AssistantPluginDeps, "edits" | "appliedEdits" | "settingsRecord" | "workbooks">;

const MAX_CHOICES = 20;
const List = z.strictObject({}).meta({ required: [] });
const Selection = z.strictObject({ edit: referenceSchema("U") });
const Labels = { spreadsheets: "Spreadsheet edit", settings: "Setting edit", notifications: "Notification edit" } as const;
const Listed = z.strictObject({ items: z.array(Selection.extend({ label: z.enum(Object.values(Labels)) })).max(MAX_CHOICES),
  notice: z.enum(["latest-unsupported", "more-matches"]).optional() });
const same = (a: JsonValue, b: JsonValue) => canonicalJsonStringify(a) === canonicalJsonStringify(b);
const stale = (): never => { throw new AssistantToolRefusal("ASSISTANT_UNDO_STALE"); };
const refused = (): never => { throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED"); };
const restored = (condition: boolean) => { if (!condition) throw new Error("assistant-undo-readback-mismatch"); };

function undoable(edit: AssistantAppliedEdit): boolean {
  const details = edit.details;
  if (details.kind === "settings") return details.path !== "preferences.assistantFullAccess" && !isRetiredSettingsPath(details.path);
  if (details.kind === "notifications") return details.prior.status !== details.next.status && same(details.prior.snooze, details.next.snooze);
  return details.command !== "create-version" && (details.command !== "save" || details.location.kind === "cell");
}

const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
const editName = (edit: AssistantAppliedEdit) => edit.label.replace(/ back$/u, "");

function targetNames(edit: AssistantAppliedEdit, notificationTitle: (edit: AssistantAppliedEdit) => string | undefined): readonly string[] {
  const { details } = edit, label = editName(edit);
  if (details.kind === "settings") return ["setting", label.replace(/^Changed /u, "")];
  if (details.kind === "notifications") {
    const title = notificationTitle(edit);
    return title === undefined ? ["notification"] : ["notification", title, `notification ${title}`];
  }
  const names = details.command === "rename" ? [z.string().parse(details.prior), z.string().parse(details.next)]
    : [label.replace(/^Changed (?:the (?:type of|link for|version of) )?|^Renamed a version of /u, "")
      .replace(/, worksheet \d+, row \d+, column \d+$/u, "")];
  return ["spreadsheet", "workbook", ...names, ...(names.some(name => /\btracker$/iu.test(name)) ? ["tracker"] : [])];
}

const choiceNumber = (token: string) => token.slice(3, token.indexOf("."));

function requestedEdits(rows: readonly AssistantAppliedEdit[], context: AssistantToolContext,
  notificationTitle: (edit: AssistantAppliedEdit) => string | undefined) {
  const text = normalize(context.operatorText).replace(/^please /u, "").replace(/[.!]$/u, "");
  if (operatorValueSpans(context.operatorText).length !== 1) return undefined;
  const request = /^(?:undo|revert)(?: the)?(?: (.+))?$/u.exec(text);
  if (request === null) return undefined;
  const target = request[1];
  if (target !== undefined && /^(?:last|latest)(?: (?:change|edit))?$/u.test(target)) {
    const latestAt = Date.parse(rows[0]?.committedAt ?? "");
    const latest = rows.filter(row => Date.parse(row.committedAt) === latestAt);
    return latest.every(undoable) ? latest : "latest-unsupported" as const;
  }
  const eligible = rows.filter(undoable);
  const number = /^(?:undo|revert) (?:the )?edit ([1-9][0-9]{0,3})$/u.exec(text)?.[1];
  if (number !== undefined) {
    const prior = context.references.issued().find(([token, entry]) => entry.kind === "U" && choiceNumber(token) === number)?.[1];
    return eligible.filter(row => row.id === prior?.target);
  }
  if (target === undefined || /^(?:change|edit)$/u.test(target)) return eligible;
  return eligible.filter(row => {
    const targets = targetNames(row, notificationTitle).map(normalize);
    return target === normalize(editName(row)) || targets.some(name => [
      name, `${name} change`, `${name} edit`, `change to ${name}`, `edit to ${name}`,
    ].includes(target));
  });
}

function display(value: JsonValue): string {
  if (value === null || value === "") return "Blank";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "type" in value && value.type === "date" && "value" in value && typeof value.value === "string") {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date(value.value));
  }
  return canonicalJsonStringify(value);
}

function reverseSetting(details: SettingEdit, read: NonNullable<UndoDeps["settingsRecord"]>, owner: EditOwner, actorId: string): Reversal {
  const atPath = (settings: unknown): SettingEdit["prior"] => {
    const value = details.path.split(".").reduce<unknown>((node, key) =>
      typeof node === "object" && node !== null && Object.hasOwn(node, key) ? Reflect.get(node, key) : undefined, settings);
    return value === undefined ? { clear: true } : { set: JsonValueSchema.parse(value) };
  };
  const show = (value: SettingEdit["prior"]) => "clear" in value ? "Unset" : value.set === true ? "On" : value.set === false ? "Off" : display(value.set);
  const current = read();
  if (current.revision !== details.revision || !same(atPath(current.settings), details.next)) stale();
  const patch = SettingsPatchSchema.parse({ [details.path]: details.prior });
  const result = owner.execute(SettingsCommandRequestSchema.parse({ commandId: owner.id, requestedAt: owner.at, requestedBy: actorId, source: "assistant",
    family: "settings", type: "apply-settings", target: { expectedRevision: current.revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint(patch), patch } }));
  if (result.state !== "applied" || result.settingsRevision === undefined) return refused();
  const saved = read();
  restored(saved.revision === result.settingsRevision && saved.revision === current.revision + 1 && same(atPath(saved.settings), details.prior));
  return { details: { ...details, revision: saved.revision, prior: details.next, next: details.prior }, before: show(details.next), after: show(details.prior) };
}

function reverseNotice(details: NoticeEdit, edits: AssistantEditOwner, owner: EditOwner, actorId: string): Reversal {
  const current = edits.notification(details.notificationId);
  if (current === undefined || current.actorId !== actorId || current.clearedAt !== undefined || current.version !== details.revision
    || current.trigger === "backfill-gap" || !same({ status: current.status, snooze: current.snooze }, details.next)) return stale();
  const command = details.prior.status === "read" ? "notification-read" : "notification-unread";
  const result = owner.execute(NotificationCommandRequestSchema.parse({ commandId: owner.id, requestedAt: owner.at, requestedBy: actorId, source: "assistant",
    family: "notification", type: command, target: { actorId, notificationId: details.notificationId, expectedVersion: current.version } }));
  if (result.state !== "applied") return refused();
  const saved = edits.notification(details.notificationId);
  if (saved === undefined) throw new Error("assistant-undo-notification-readback-missing");
  restored(saved.version === current.version + 1 && same({ status: saved.status, snooze: saved.snooze }, details.prior));
  return { details: { ...details, command, revision: saved.version, prior: details.next, next: details.prior },
    before: details.next.status, after: details.prior.status };
}

function sheetChange(details: SheetEdit, entry: WorkbookLibraryEntry, types: ReturnType<ReturnType<UndoDeps["workbooks"]>["types"]>) {
  const { prior, next, location } = details;
  const version = (id: JsonValue) => entry.state.versions.find(row => row.id === id);
  switch (details.command) {
    case "rename":
      return { change: { kind: "rename", name: prior }, current: entry.name, before: display(next), after: display(prior) };
    case "metadata":
    case "link": {
      const metadata = WorkbookMetadataSchema.parse(prior), changed = WorkbookMetadataSchema.parse(next);
      const title = (id: string) => types.find(row => row.id === id)?.name;
      const links = !same(metadata.sharePoint, changed.sharePoint);
      const before = links ? changed.sharePoint?.url ?? "Unlinked" : title(changed.typeId);
      const after = links ? metadata.sharePoint?.url ?? "Unlinked" : title(metadata.typeId);
      if (before === undefined || after === undefined) return stale();
      return { change: { kind: "metadata", metadata }, current: entry.metadata, before, after };
    }
    case "use-version": {
      const before = version(next)?.name, after = version(prior)?.name;
      if (before === undefined || after === undefined) return stale();
      return { change: { kind: "use-version", versionId: prior }, current: entry.state.selectedVersionId, before, after };
    }
    case "rename-version": {
      if (location.kind !== "version") return refused();
      const current = version(location.versionId);
      if (current === undefined) return stale();
      return { change: { kind: "rename-version", versionId: location.versionId, name: prior }, current: current.name, before: display(next), after: display(prior) };
    }
    default: return refused();
  }
}

function reverseSheet(details: SheetEdit, library: ReturnType<UndoDeps["workbooks"]>, edits: AssistantEditOwner, owner: EditOwner): Reversal {
  const { libraryId, prior, next, location } = details;
  const entry = () => {
    const row = library.catalog().find(item => item.libraryId === libraryId);
    if (row === undefined || row.state.removed || row.state.origin.kind !== "local") return stale();
    return row;
  };
  const current = entry();
  if (current.version !== details.ownerRevision.version || current.state.revision !== details.ownerRevision.revision) return stale();
  const result = (command: SheetEdit["command"], saved: WorkbookLibraryEntry, before: string, after: string): Reversal => ({
    details: { ...details, command, ownerRevision: { version: saved.version, revision: saved.state.revision }, prior: next, next: prior }, before, after,
  });
  if (details.command === "save") {
    if (location.kind !== "cell") return refused();
    const findCell = (workbook: ReturnType<typeof encodeEditableWorkbook>) =>
      workbook.sheets.find(sheet => sheet.id === location.sheetId)?.rows.find(row => row.id === location.rowId)?.cells[location.column];
    const workbook = encodeEditableWorkbook(library.read(libraryId).workbook), cell = findCell(workbook);
    if (cell === undefined || cell.richText !== undefined || cell.hyperlink !== undefined || !same(cell.value, next)) return stale();
    cell.value = WorkbookCellChangeSchema.shape.oldValue.parse(prior);
    const write = edits.workbooks().operatorOperation(libraryId, owner.id, { kind: "save", expectedVersion: current.version, workbook });
    if (write.state !== "applied") return refused();
    const saved = entry(), cellAfter = findCell(encodeEditableWorkbook(library.read(libraryId).workbook));
    restored(saved.version === write.version && cellAfter !== undefined && same(cellAfter.value, prior));
    return result("save", saved, display(next), display(prior));
  }
  const types = library.types(), inverse = sheetChange(details, current, types);
  if (!same(inverse.current, next)) return stale();
  const change = WorkbookLibraryChangeSchema.parse(inverse.change);
  const write = edits.workbooks().localLibraryAction(libraryId, { operationId: owner.id, expectedVersion: current.version,
    expectedRevision: current.state.revision, change }, owner.at);
  const saved = entry();
  const reversed = { ...details, prior: next, next: prior };
  restored(saved.state.revision === write.result.revision && same(sheetChange(reversed, saved, types).current, prior));
  if (change.kind !== "rename" && change.kind !== "metadata" && change.kind !== "rename-version" && change.kind !== "use-version") return refused();
  return result(change.kind, saved, inverse.before, inverse.after);
}

export function undoPlugin(deps: UndoDeps): AssistantPlugin {
  const { edits, appliedEdits, settingsRecord } = deps;
  if (edits === undefined || appliedEdits === undefined || settingsRecord === undefined) return { domain: "undo", tools: [] };
  const entries = (actorId: string) => {
    const now = appliedEdits.clock.now(), day = searchPartitionDay(now);
    return appliedEdits.list(`${day}T00:00:00.000Z`).filter(row => row.actorId === actorId && Date.parse(row.committedAt) <= now.getTime()
      && searchPartitionDay(new Date(row.committedAt)) === day)
      .sort((left, right) => Date.parse(right.committedAt) - Date.parse(left.committedAt));
  };
  const notificationTitle = (row: AssistantAppliedEdit) => {
    const notice = row.details.kind === "notifications" ? edits.notification(row.details.notificationId) : undefined;
    return notice?.actorId === row.actorId ? notice.title : undefined;
  };
  return { domain: "undo", tools: [{
    kind: "read", tier: "read", name: "list_today_edits", parameters: List, output: Listed, privacy: [],
    description: "Find your assistant edits today. For latest-unsupported, say the latest edit cannot be undone. For more-matches, ask them to say undo with a kind or target name. Otherwise for multiple matches, reply with one '- [[U…]]' line per edit, then 'Which edit should I undo?'",
    async invoke(input, context) {
      List.parse(input);
      const rows = entries(context.actorId), matches = requestedEdits(rows, context, notificationTitle);
      context.assertCurrent();
      if (matches === "latest-unsupported") {
        observeEdit(context, "undo:selected", "");
        return { items: [], notice: matches };
      }
      observeEdit(context, "undo:selected", matches?.length === 1 ? matches[0]?.id ?? "" : "");
      const visible = matches ?? rows.filter(undoable);
      return { ...(visible.length > MAX_CHOICES ? { notice: "more-matches" } : {}), items: visible.slice(0, MAX_CHOICES).map(row => {
        const issued = context.references.issued().filter(([, entry]) => entry.kind === "U");
        const title = notificationTitle(row);
        const token = context.references.issue("U", row.id, `Edit ${String(issued.length + 1)} — ${row.label}${title === undefined ? "" : ` — ${title}`}`);
        return { edit: token, label: Labels[row.details.kind] };
      }) };
    },
  }, {
    kind: "change", tier: "write-local", name: "undo_edit", parameters: Selection, output: AssistantChangeOutput, privacy: [],
    description: "Undo one edit from list_today_edits on an explicit undo request naming it. If several edits match, ask which. A reply such as 'undo edit 1' selects Edit 1.",
    async change(input, context) {
      const { edit } = Selection.parse(input), selected = context.references.resolve(edit, ["U"]).target;
      if (context.editReads.get("undo:selected") !== selected) return refused();
      return () => {
        try {
          const reply = edits.apply(context, owner => {
            const matches = requestedEdits(entries(context.actorId), context, notificationTitle);
            if (matches === "latest-unsupported") return stale();
            const row = matches?.[0];
            if (row?.id !== selected || matches?.length !== 1) return stale();
            const { details } = row;
            const reversal = details.kind === "settings" ? reverseSetting(details, settingsRecord, owner, context.actorId)
              : details.kind === "notifications" ? reverseNotice(details, edits, owner, context.actorId)
                : reverseSheet(details, deps.workbooks(), edits, owner);
            return { ...reversal, label: `${editName(row)} back` };
          });
          const first = reply.kind === "text" ? reply.runs[0] : undefined;
          if (reply.kind !== "text" || first?.kind !== "plain" || !first.text.endsWith(" to ")) {
            throw new Error("assistant-undo-reply-mismatch");
          }
          const prefix: AssistantReplyPart = { ...reply, runs: [{ kind: "plain", text: first.text.slice(0, -4) + ": " }, ...reply.runs.slice(1)] };
          return prefix;
        } catch (error) {
          if (error instanceof WorkbookLibraryError && error.code === "WORKBOOK_VERSION_CONFLICT") return stale();
          throw error;
        }
      };
    },
  }] };
}
