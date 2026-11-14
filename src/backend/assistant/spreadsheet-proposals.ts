import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AssistantActionProposalSchema, type AssistantActionDecision, type AssistantActionProposal, type AssistantActionResult, type AssistantFailureCode } from "../../models/dashboard/assistant.js";
import { encodeEditableWorkbook } from "../../models/dashboard/workbooks.js";
import type { WorkbookLibraryChangeSchema } from "../../models/dashboard/workbook-library.js";
import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { Clock } from "../../rules/time/clock.js";
import type { CommandKernel } from "../runs/commands/command-kernel.js";
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import { WorkbookLibraryError } from "../workbooks/workbook-library-error.js";
import type { WorkbookLibraryService } from "../workbooks/workbook-library-service.js";
import type { createAssistantAuthorization } from "./authorization.js";
import { AssistantToolRefusal, referenceSchema, type AssistantProposalTool, type AssistantToolContext } from "./plugins/plugin.js";
import type { AssistantPluginDeps } from "./plugins/registry.js";
import { attachmentWorkbook, catalogEntry, dataRows } from "./plugins/spreadsheets/index.js";

export type AssistantSpreadsheetLibrary = Pick<WorkbookLibraryService, "catalog" | "read" | "types" | "create" | "operatorOperation" | "libraryAction" | "libraryActionRecord" | "journal">;
export interface AssistantSpreadsheetProposalDeps {
  readonly database: AuthorityDatabase;
  readonly authorization: ReturnType<typeof createAssistantAuthorization>;
  readonly kernel: Pick<CommandKernel, "assistantManifest">;
  readonly clock: Clock;
  workbooks(): AssistantSpreadsheetLibrary;
  attachment: AssistantPluginDeps["attachment"];
  assertCurrent(): void;
}

const TTL_MS = 60_000;
const Sheet = referenceSchema("S"), File = referenceSchema("A"), Version = referenceSchema("V");
const Text = z.string().min(1).max(320);
export const SpreadsheetChangeParameters = z.strictObject({ change: z.union([
  z.strictObject({ action: z.literal("import"), file: File, name: Text }),
  z.strictObject({ action: z.literal("new-version"), sheet: Sheet, file: File }),
  z.strictObject({ action: z.literal("set-type"), sheet: Sheet, type: referenceSchema("T") }),
  z.strictObject({ action: z.literal("sync"), sheet: Sheet }),
  z.strictObject({ action: z.literal("link"), sheet: Sheet, url: Text }),
  z.strictObject({ action: z.literal("unlink"), sheet: Sheet }),
  z.strictObject({ action: z.literal("rename"), sheet: Sheet, name: Text }),
  z.strictObject({ action: z.literal("create-version"), sheet: Sheet, name: Text,
    from: z.union([z.strictObject({ kind: z.literal("version"), version: Version }), z.strictObject({ kind: z.literal("sharepoint") })]), useNow: z.boolean() }),
  z.strictObject({ action: z.literal("use-version"), sheet: Sheet, version: Version }),
  z.strictObject({ action: z.literal("rename-version"), sheet: Sheet, version: Version, name: Text }),
]) });
type Change = z.infer<typeof SpreadsheetChangeParameters>["change"];
type LibraryChange = z.infer<typeof WorkbookLibraryChangeSchema>;
type ImportedWorkbook = Awaited<ReturnType<typeof attachmentWorkbook>>["workbook"];
/** The exact owner call Confirm makes, fixed at issue. */
type Pinned =
  | Readonly<{ kind: "create"; name: string; workbook: ImportedWorkbook }>
  | Readonly<{ kind: "operation"; libraryId: string; operationId: string; change: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "library-action"; libraryId: string; action: Readonly<{ operationId: string; expectedRevision: number; expectedVersion: number; change: LibraryChange }> }>;
interface Issued {
  readonly chatId: string;
  readonly revision: number;
  readonly expiresAt: string;
  readonly digest: string;
  readonly label: string;
  readonly conversationId: string;
  readonly pinned: Pinned;
  state: "issued" | "claimed" | "settled" | "unknown" | "cancelled";
  /** Re-reads every binding captured at issue; throws a refusal on any change. */
  assertIssued(): void;
}

const digestOf = (proposal: AssistantActionProposal) => createHash("sha256").update(canonicalJsonStringify(proposal)).digest("hex");
const LABELS: Readonly<Record<Change["action"], string>> = {
  "import": "Import spreadsheet", "new-version": "Save new spreadsheet version", "set-type": "Set spreadsheet type", "sync": "Download from SharePoint",
  "link": "Link spreadsheet to SharePoint", "unlink": "Unlink spreadsheet from SharePoint", "rename": "Rename spreadsheet", "create-version": "Create spreadsheet version",
  "use-version": "Use spreadsheet version", "rename-version": "Rename spreadsheet version",
};
/** A binding that changed after issue; nothing was written. */
const staleCode = (error: unknown): AssistantFailureCode => error instanceof AssistantToolRefusal ? error.code : "ASSISTANT_CONTEXT_STALE";
const rowsOf = (workbook: ImportedWorkbook) => String(workbook.sheets.reduce((sum, sheet) => sum + dataRows(sheet), 0));

/** `propose_spreadsheet_change` and its Confirm: one pinned owner call per card, claimed once, settled from the owner's result. */
export function createSpreadsheetProposals(deps: AssistantSpreadsheetProposalDeps) {
  const issued = new Map<string, Issued>();
  const prune = () => { for (const [id, entry] of issued) if (entry.state !== "claimed" && Date.parse(entry.expiresAt) <= deps.clock.nowMs()) issued.delete(id); };
  /** Profile, epoch and tool contract; a change to any refuses the card. */
  const authority = (chatId: string) => {
    const chat = deps.database.authority.assistantAuthorization.chat(chatId);
    if (chat === undefined) throw new AssistantToolRefusal("ASSISTANT_PROPOSAL_REFUSED");
    return canonicalJsonStringify({ profileId: chat.profileId, epoch: chat.epoch, manifestRevision: deps.kernel.assistantManifest().revision });
  };
  const typed = (context: AssistantToolContext, value: string) => { if (!context.operatorText.includes(value)) throw new AssistantToolRefusal("ASSISTANT_INVALID"); return value; };
  const versionOf = (context: AssistantToolContext, entry: ReturnType<typeof catalogEntry>, token: string) => {
    const [libraryId, versionId] = context.references.resolve(token, ["V"]).target.split(":");
    const version = entry.state.versions.find(candidate => candidate.id === versionId);
    if (libraryId !== entry.libraryId || version === undefined) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
    return version;
  };

  async function build(change: Change, context: AssistantToolContext) {
    const facts: { label: string; value: string }[] = [];
    let attachment: Readonly<{ id: string; sha256: string }> | undefined;
    if (change.action === "import") {
      const parsed = await attachmentWorkbook(deps, context, change.file), name = typed(context, change.name);
      attachment = parsed;
      const record = deps.attachment(context.conversationId, parsed.id);
      facts.push({ label: "File", value: record?.name ?? parsed.workbook.name }, { label: "Name", value: name },
        { label: "Worksheets", value: String(parsed.workbook.sheets.length) }, { label: "Rows", value: rowsOf(parsed.workbook) });
      return { facts, attachment, target: name, pinned: { kind: "create", name, workbook: { ...parsed.workbook, name } } as Pinned };
    }
    const entry = catalogEntry(deps, context, change.sheet), libraryId = entry.libraryId, operationId = randomUUID();
    // Staleness of the workbook itself is the owner's: its expected version and revision refuse a changed library.
    const base = { facts, target: entry.name };
    facts.push({ label: "Workbook", value: entry.name });
    const action = (libraryChange: LibraryChange) => ({ ...base, attachment,
      pinned: { kind: "library-action", libraryId, action: { operationId, expectedRevision: entry.state.revision, expectedVersion: entry.version, change: libraryChange } } as Pinned });
    switch (change.action) {
      case "new-version": {
        const parsed = await attachmentWorkbook(deps, context, change.file), current = deps.workbooks().read(libraryId);
        facts.push({ label: "Version", value: `${String(entry.version)} → ${String(entry.version + 1)}` }, { label: "File", value: deps.attachment(context.conversationId, parsed.id)?.name ?? parsed.workbook.name },
          { label: "Worksheets", value: String(parsed.workbook.sheets.length) }, { label: "Rows", value: rowsOf(parsed.workbook) });
        const workbook = encodeEditableWorkbook({ ...parsed.workbook, name: current.workbook.name, libraryId });
        return { ...base, attachment: parsed, pinned: { kind: "operation", libraryId, operationId, change: { kind: "save", expectedVersion: entry.version, workbook } } as Pinned };
      }
      case "set-type": {
        const typeId = context.references.resolve(change.type, ["T"]).target, type = deps.workbooks().types().find(candidate => candidate.id === typeId);
        if (type === undefined) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
        facts.push({ label: "Type", value: `${entry.type.name} → ${type.name}` });
        return { ...base, attachment, pinned: { kind: "operation", libraryId, operationId,
          change: { kind: "metadata", expectedVersion: entry.version, metadata: { typeId, sharePoint: entry.metadata.sharePoint } } } as Pinned };
      }
      case "sync": facts.push({ label: "Change", value: "Download from SharePoint" }); return action({ kind: "sync" });
      case "link": { const url = typed(context, change.url); facts.push({ label: "Link", value: url }); return action({ kind: "link", url }); }
      case "unlink": facts.push({ label: "Change", value: "Remove the SharePoint link" }); return action({ kind: "unlink" });
      case "rename": { const name = typed(context, change.name); facts.splice(0, 1, { label: "Name", value: `${entry.name} → ${name}` }); return action({ kind: "rename", name }); }
      case "create-version": {
        const name = typed(context, change.name), source = change.from.kind === "version" ? versionOf(context, entry, change.from.version) : undefined;
        facts.push({ label: "Version name", value: name }, { label: "Source", value: source?.name ?? "SharePoint" }, { label: "Becomes the version in use", value: change.useNow ? "Yes" : "No" });
        return action({ kind: "create-version", name, from: source === undefined ? { kind: "sharepoint" } : { kind: "version", versionId: source.id }, useNow: change.useNow });
      }
      case "use-version": {
        const version = versionOf(context, entry, change.version), inUse = entry.state.versions.find(candidate => candidate.id === entry.state.selectedVersionId);
        facts.push({ label: "Version", value: `${inUse?.name ?? String(entry.version)} → ${version.name}` });
        return action({ kind: "use-version", versionId: version.id });
      }
      case "rename-version": {
        const version = versionOf(context, entry, change.version), name = typed(context, change.name);
        facts.push({ label: "Version", value: `${version.name} → ${name}` });
        return action({ kind: "rename-version", versionId: version.id, name });
      }
    }
  }

  const tool: AssistantProposalTool = { kind: "proposal", tier: "write-local", name: "propose_spreadsheet_change",
    description: "Prepare a card for one Spreadsheets library change; the operator confirms it. import: add an attached spreadsheet as a new workbook under a name the operator typed (it starts without a type; "
      + "set the type with a separate set-type card after it is imported). new-version: save an attached spreadsheet as the workbook's next version. set-type, sync (download from SharePoint), "
      + "link (a SharePoint URL the operator typed), unlink, rename, create-version (from a named version or SharePoint), use-version (publish a named version), rename-version. "
      + "Names and URLs must be exactly what the operator typed. Spreadsheets are never workflow inputs.",
    parameters: SpreadsheetChangeParameters,
    async propose(value, context) {
      const { change } = SpreadsheetChangeParameters.parse(value);
      const built = await build(change, context);
      context.assertCurrent();
      const chat = deps.authorization.createChat(), captured = authority(chat.chatId);
      const attachment = built.attachment, conversationId = context.conversationId;
      let expiresAt = "";
      const assertIssued = () => {
        if (expiresAt !== "" && Date.parse(expiresAt) <= deps.clock.nowMs()) throw new Error("assistant-action-not-current");
        deps.assertCurrent(); context.assertRetainedCurrent();
        if (authority(chat.chatId) !== captured) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
        if (deps.database.authority.assistantHistory.conversation(conversationId, deps.clock.now().toISOString()) === undefined) throw new AssistantToolRefusal("ASSISTANT_CONVERSATION_STALE");
        if (attachment !== undefined && deps.attachment(conversationId, attachment.id)?.sha256 !== attachment.sha256) throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNAVAILABLE");
      };
      assertIssued();
      const actionId = randomUUID(), label = LABELS[change.action];
      expiresAt = new Date(Math.min(deps.clock.nowMs() + TTL_MS, Date.parse(deps.database.authority.assistantAuthorization.chat(chat.chatId)?.expiresAt ?? ""))).toISOString();
      const proposal = AssistantActionProposalSchema.parse({ chatId: chat.chatId, actionId, revision: 1, expiresAt, label, targetLabel: built.target.slice(0, 160),
        effect: "spreadsheet", action: change.action, facts: built.facts });
      prune();
      issued.set(actionId, { chatId: chat.chatId, revision: 1, expiresAt, digest: digestOf(proposal), label, conversationId, pinned: built.pinned, state: "issued", assertIssued });
      return proposal;
    } };

  /** Runs the pinned owner call; `assertIssued` runs immediately before each repository write. */
  async function run(entry: Issued, signal: AbortSignal): Promise<"applied" | "refused"> {
    const library = deps.workbooks(), pinned = entry.pinned;
    if (pinned.kind === "create") { entry.assertIssued(); library.create(pinned.workbook); return "applied"; }
    if (pinned.kind === "operation") { entry.assertIssued(); return library.operatorOperation(pinned.libraryId, pinned.operationId, pinned.change).state === "applied" ? "applied" : "refused"; }
    await library.libraryAction(pinned.libraryId, pinned.action, signal, () => { entry.assertIssued(); });
    return "applied";
  }
  /** After a throw: the owner's own record of this operation, when it has one. */
  function readback(pinned: Pinned): "applied" | "refused" | undefined {
    try {
      if (pinned.kind === "library-action") return deps.workbooks().libraryActionRecord(pinned.libraryId, pinned.action.operationId) === undefined ? undefined : "applied";
      if (pinned.kind === "operation") {
        const receipt = deps.workbooks().journal(pinned.libraryId).find(candidate => candidate.operationId === pinned.operationId);
        return receipt === undefined ? undefined : receipt.state === "applied" ? "applied" : "refused";
      }
    } catch { /* an unreadable library leaves the outcome unknown */ }
    return undefined;
  }

  return Object.freeze({
    tool,
    has: (actionId: string) => issued.has(actionId),
    /** Confirm or Cancel one issued spreadsheet card; after the claim nothing is retried and an unproved outcome is UNKNOWN. */
    async decide(decision: AssistantActionDecision, signal: AbortSignal): Promise<AssistantActionResult> {
      signal.throwIfAborted();
      const entry = issued.get(decision.actionId);
      if (entry === undefined || entry.state !== "issued" || entry.chatId !== decision.chatId || entry.revision !== decision.revision) throw new Error("assistant-action-not-current");
      if (Date.parse(entry.expiresAt) <= deps.clock.nowMs()) throw new AssistantToolRefusal("ASSISTANT_PROPOSAL_EXPIRED");
      const caption = (text: string, modelText?: string) => {
        try { deps.database.authority.assistantHistory.appendDecision({ conversationId: entry.conversationId, actionId: decision.actionId, messageId: randomUUID(), text,
          ...(modelText === undefined ? {} : { modelText }), now: deps.clock.now().toISOString() }); } catch { /* readback shows the caption is missing */ }
      };
      if (decision.decision === "cancel") {
        entry.state = "cancelled";
        caption(`Not done: ${entry.label}.`);
        return { state: "cancelled", actionId: decision.actionId };
      }
      if (decision.reviewedDigest !== entry.digest) throw new Error("assistant-reviewed-proposal-mismatch");
      const refuse = (code: AssistantFailureCode): AssistantActionResult => { entry.state = "settled"; caption(`Not done: ${entry.label}. ${ERROR_CATALOG[code].text}`); return { state: "refused", code }; };
      try { entry.assertIssued(); } catch (error) { return refuse(staleCode(error)); }
      entry.state = "claimed";
      let stale: AssistantFailureCode | undefined;
      const guarded: Issued = { ...entry, assertIssued() { try { entry.assertIssued(); } catch (error) { stale = staleCode(error); throw error; } signal.throwIfAborted(); } };
      let outcome: "applied" | "refused" | undefined;
      try { outcome = await run(guarded, signal); }
      catch (error) {
        if (stale !== undefined) return refuse(stale);
        outcome = error instanceof WorkbookLibraryError ? "refused" : readback(entry.pinned);
      }
      if (outcome === "refused") return refuse("ASSISTANT_SPREADSHEET_REFUSED");
      if (outcome === "applied") { entry.state = "settled"; caption(`Done: ${entry.label}.`); return { state: "applied", actionId: decision.actionId }; }
      entry.state = "unknown";
      const check = entry.pinned.kind === "create" ? ` Check the Spreadsheets library for ${entry.pinned.name}.` : "";
      caption(`${ERROR_CATALOG.ASSISTANT_OUTCOME_UNKNOWN.text}${check}`, `Outcome unknown: ${entry.label}. Do not retry.`);
      return { state: "unknown", actionId: decision.actionId };
    },
  });
}
