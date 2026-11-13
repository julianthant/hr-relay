import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ASSISTANT_FAILURES, AssistantActionProposalSchema, ASSISTANT_START_ROWS_MAX, type AssistantActionDecision, type AssistantActionProposal, type AssistantActionResult,
  type AssistantProposalRow } from "../../models/dashboard/assistant.js";
import type { RerunValuesResponse } from "../../models/dashboard/rerun-values.js";
import { NotificationCollectionOperationSchema, type NotificationCollectionOperation } from "../../models/notifications/notifications.js";
import { PersonLookupCanonicalInput } from "../../models/workflows/person-lookup/input.js";
import { EmergencyContactInputSchema } from "../../models/workflows/emergency-contact/input.js";
import type { OcrFormType } from "../../models/ocr/form-registry.js";
import type { OcrSourceService } from "../runs/commands/ocr-source-service.js";
import { SchemaBoundCanonicalValueSchema } from "../../models/validation/schema-bound-value.js";
import { parseInputRunText, toRawSubmission } from "../../models/workflow/ingress.js";
import { CommandRequestSchema, StartCommandRequestSchema, type CommandRequest } from "../../rules/commands/commands.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../rules/validation/canonical-json.js";
import type { Clock } from "../../rules/time/clock.js";
import { workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../workflow-kit/workflow.js";
import type { DashboardCommandService } from "../runs/commands/command-service.js";
import type { StartPlanService } from "../runs/commands/start-plan-service.js";
import type { RunRecordService } from "../runs/lifecycle/run-record-service.js";
import { selectActiveRunSettings } from "../runs/settings/run-settings.js";
import { hasProtectedSubject } from "../runs/start/protected-input.js";
import { requireTrustRun } from "../runs/trust/run-reader.js";
import type { AuthorityDatabase } from "../storage/sqlite/authority-database.js";
import type { createAssistantAuthorization } from "./authorization.js";
import { AssistantToolRefusal, referenceSchema, type AssistantPlugin, type AssistantToolContext } from "./plugins/plugin.js";
import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";
import { createSpreadsheetProposals, type AssistantSpreadsheetProposalDeps } from "./spreadsheet-proposals.js";

export interface AssistantProposalDeps extends Pick<AssistantSpreadsheetProposalDeps, "kernel" | "workbooks" | "attachment"> {
  readonly database: AuthorityDatabase;
  readonly authorization: ReturnType<typeof createAssistantAuthorization>;
  readonly plans: StartPlanService;
  readonly commands: Pick<DashboardCommandService, "submit" | "publish" | "completeConsumed">;
  readonly runs: Pick<RunRecordService, "read">;
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  readonly rerunValues: (request: unknown) => RerunValuesResponse;
  /** Registers an attached PDF as an OCR source (D6); a local write, like preparing a plan. */
  ocrSources(): Pick<OcrSourceService, "upload">;
  served(workflowId: string): boolean;
  readonly actorId: string;
  readonly clock: Clock;
  assertCurrent(): void;
}

type StoredPlan = NonNullable<ReturnType<AuthorityDatabase["authority"]["startPlans"]["get"]>>;
type ActionRecord = NonNullable<ReturnType<AuthorityDatabase["authority"]["assistantAuthorization"]["action"]>>;
interface Pending {
  readonly chat: ReturnType<ReturnType<typeof createAssistantAuthorization>["createChat"]>;
  readonly revision: number;
  readonly expiresAt: string;
  readonly record: ActionRecord;
  readonly digest: string;
  readonly start: boolean;
  /** The conversation whose turn issued the card and the card's fixed-verb label; the decision caption uses both. */
  readonly conversationId: string;
  readonly label: string;
  assertCurrent(): void;
  assertApplied(): void;
}

const PLAN_LIFECYCLE_FIELDS = new Set(["version", "consumedBy", "updatedAt"]);
const planImmutables = (plan: StoredPlan) => canonicalJsonStringify(Object.fromEntries(Object.entries(plan).filter(([key]) => !PLAN_LIFECYCLE_FIELDS.has(key))));
const digestOf = (proposal: AssistantActionProposal) => createHash("sha256").update(canonicalJsonStringify(proposal)).digest("hex");
function refuse(): never { throw new AssistantToolRefusal("ASSISTANT_PROPOSAL_REFUSED"); }

/** Workflows whose one input is an OCR document of a fixed form; an attached PDF is their start entry (D6). */
const PDF_START_FORMS: Readonly<Partial<Record<string, OcrFormType>>> = { "emergency-contact": "emergency-contact" };

/** What one planned row shows: the typed identity of its canonical input, never model text; an OCR file row names its registered source. */
export function plannedRowDisplay(workflowId: string, input: unknown, sourceName: (artifactId: string) => string | undefined = () => undefined): AssistantProposalRow["display"] {
  const bound = SchemaBoundCanonicalValueSchema.safeParse(input);
  if (!bound.success) return { kind: "request" };
  const formType = PDF_START_FORMS[workflowId];
  if (formType !== undefined) {
    const parsed = EmergencyContactInputSchema.safeParse(bound.data.value), fileName = parsed.success ? sourceName(parsed.data.document.id) : undefined;
    return fileName === undefined ? { kind: "request" } : { kind: "file", fileName, formType };
  }
  if (workflowId === "person-lookup") {
    const parsed = PersonLookupCanonicalInput.safeParse(bound.data.value);
    if (!parsed.success) return { kind: "request" };
    const value = parsed.data, name = value.mode === "match" ? `${value.lastName}, ${value.firstName}` : value.name;
    if (name === undefined && !("emplId" in value)) return { kind: "request" };
    return { kind: "person", ...(name === undefined ? {} : { name }), ...("emplId" in value && value.emplId !== undefined ? { employeeId: value.emplId } : {}) };
  }
  const document = z.object({ documentNumber: z.string().min(1).max(40) }).safeParse(bound.data.value);
  return document.success ? { kind: "document", documentNumber: document.data.documentNumber } : { kind: "request" };
}
const countLabel = (rows: readonly AssistantProposalRow[]) => {
  const kind = rows[0]?.display.kind, n = rows.length;
  if (rows.some(row => row.display.kind !== kind)) return n === 1 ? "1 request" : `${String(n)} requests`;
  const noun = kind === "person" ? ["person", "people"] : kind === "document" ? ["document", "documents"] : kind === "file" ? ["file", "files"] : ["request", "requests"];
  return n === 1 ? `1 ${noun[0]}` : `${String(n)} ${noun[1]}`;
};
const NOTIFICATION_ACTIONS = { read: "notification-read", unread: "notification-unread", snooze: "notification-snooze", unsnooze: "notification-unsnooze" } as const;
const ChangeOutput = z.strictObject({ state: z.literal("applied"), count: z.number().int().positive() });

/** The proposal tools and the one Confirm owner; nothing here dispatches before the operator confirms an issued card. */
export function createAssistantProposals(deps: AssistantProposalDeps) {
  const pending = new Map<string, Pending>();
  const spreadsheets = createSpreadsheetProposals(deps);
  const prune = () => { for (const [id, entry] of pending) if (Date.parse(entry.expiresAt) <= deps.clock.nowMs()) pending.delete(id); };
  const settings = () => deps.database.withAuthorityReadSnapshot(() => selectActiveRunSettings(deps.database.authority));

  /** A served workflow the assistant may start: dry run when supported, a live read when it has no transaction node. */
  function startable(workflowId: string) {
    const descriptor = deps.descriptors.resolve(workflowId);
    if (descriptor === undefined || !deps.served(workflowId)) refuse();
    const support = workflowDryRunSupport(descriptor);
    if (support.state !== "supported" && !("reason" in support && support.reason === "no-transaction-node")) refuse();
    return { descriptor, dryRun: support.state === "supported" };
  }
  /** A run whose retained input may be reused: same workflow, served, no protected subject, current definition. */
  function reusableRun(runId: string, workflowId: string) {
    const run = requireTrustRun(deps.runs, runId);
    const descriptor = deps.descriptors.resolve(run.envelope.workflow);
    if (run.envelope.workflow !== workflowId || !deps.served(workflowId) || hasProtectedSubject(run.input.parsed.protectedBindings) || descriptor === undefined
      || descriptor.version !== run.envelope.descriptorVersion || descriptor.contractFingerprint !== run.envelope.contractFingerprint) refuse();
    return run;
  }

  /** Issues the authorization record and the card; `assertCurrent` is what Confirm and the command effect recheck. */
  function issue(command: CommandRequest, context: AssistantToolContext, card: (identity: { chatId: string; actionId: string; revision: number; expiresAt: string }) => AssistantActionProposal,
    checks: Readonly<{ assertCurrent(): void; assertApplied?(): void; planExpiresAt?: string }>) {
    const chat = deps.authorization.createChat(), prepared = deps.authorization.prepare(chat, command);
    const record = deps.database.authority.assistantAuthorization.action(prepared.id);
    if (record === undefined || record.chatId !== chat.chatId) refuse();
    const issuedRecord = record;
    const expiresAt = new Date(Math.min(Date.parse(issuedRecord.expiresAt), Date.parse(checks.planExpiresAt ?? issuedRecord.expiresAt))).toISOString();
    const retained = () => context.assertRetainedCurrent();
    const assertCurrent = () => { deps.assertCurrent(); retained(); checks.assertCurrent(); };
    assertCurrent();
    const proposal = AssistantActionProposalSchema.parse(card({ chatId: chat.chatId, actionId: prepared.id, revision: prepared.revision, expiresAt }));
    prune();
    pending.set(prepared.id, { chat, revision: prepared.revision, expiresAt, record: issuedRecord, digest: digestOf(proposal), start: command.family === "start",
      conversationId: context.conversationId, label: proposal.label,
      assertCurrent, assertApplied: checks.assertApplied ?? (() => {}) });
    return proposal;
  }

  async function planStart(context: AssistantToolContext, input: Readonly<{ workflowId: string; submissions: readonly JsonValue[]; rerunSource?: JsonValue;
    selectedStepKeys?: readonly string[]; source: "entries" | "run" | "rerun"; accepts(planned: StoredPlan["planned"]): boolean; assertSource(): void }>) {
    const { descriptor, dryRun } = startable(input.workflowId), active = settings();
    const request = { workflowId: descriptor.id, submissions: [...input.submissions], dryRun, browserMode: active.config.browser.headless ? "headless" as const : "headed" as const,
      captureBrowserScreenshots: true, ...(input.rerunSource === undefined ? {} : { rerunSource: input.rerunSource }),
      ...(input.selectedStepKeys === undefined ? {} : { selectedStepKeys: [...input.selectedStepKeys] }) };
    await deps.plans.prepare?.(request, context.signal);
    context.assertCurrent(); input.assertSource();
    const planned = deps.plans.plan(request), stored = deps.database.authority.startPlans.get(planned.startPlanId);
    if (stored === undefined || stored.refused.length > 0 || !input.accepts(stored.planned) || stored.stepOmissions !== undefined || (input.source !== "rerun" && stored.rerun !== undefined)) refuse();
    const plan = stored, issuedPlan = planImmutables(plan);
    const command = StartCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: deps.clock.now().toISOString(), requestedBy: deps.actorId, source: "assistant",
      family: "start", type: "start-run", target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.version }, payload: planned.fingerprints });
    // Currentness may run after a successful submit, so the plan this exact command consumed stays current.
    const assertPlan = (consumed: boolean) => {
      const current = deps.database.authority.startPlans.get(plan.startPlanId);
      if (current === undefined || planImmutables(current) !== issuedPlan) refuse();
      if (current.consumedBy === undefined ? consumed || current.version !== plan.version
        : current.consumedBy.commandId !== command.commandId || current.version !== plan.version + 1) refuse();
    };
    const sourceName = (artifactId: string) => deps.database.authority.ocrReviews.source(artifactId)?.fileName;
    const rows = plan.planned.map(run => ({ title: run.title, ...(run.subtitle === undefined ? {} : { subtitle: run.subtitle }), display: plannedRowDisplay(plan.workflowId, run.input, sourceName) }));
    return issue(command, context, identity => ({ ...identity, label: `${input.source === "rerun" ? "Rerun" : "Start"} ${descriptor.label}`, targetLabel: countLabel(rows),
      effect: "workflow-start", source: input.source, workflowId: descriptor.id, dryRun, startPlan: {
        startPlanId: planned.startPlanId, workflowId: planned.workflowId, expectedVersion: planned.expectedVersion, expiresAt: planned.expiresAt, dryRun: planned.dryRun,
        browserMode: planned.browserMode ?? request.browserMode, captureBrowserScreenshots: true, fingerprints: planned.fingerprints, planned: rows } }), {
      planExpiresAt: plan.expiresAt,
      assertCurrent() {
        input.assertSource(); assertPlan(false);
        const current = settings();
        if (current.configSnapshotId !== plan.configSnapshotId || current.fingerprint !== plan.configFingerprint) refuse();
      },
      assertApplied() { assertPlan(true); },
    });
  }

  const startParameters = z.strictObject({ workflow: z.string().min(1).max(80), entries: z.array(z.string().min(1).max(400)).min(1).max(ASSISTANT_START_ROWS_MAX) });
  /** An attached PDF of this chat, registered as an OCR source; the entry becomes that document's input. */
  async function pdfEntry(entry: string, context: AssistantToolContext) {
    const record = deps.attachment(context.conversationId, context.references.resolve(entry, ["A"]).target);
    if (record === undefined) throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNAVAILABLE");
    if (record.mediaType !== "application/pdf") throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNSUPPORTED");
    context.assertCurrent();
    const source = await deps.ocrSources().upload({ actorId: "local-operator", fileName: record.name, mediaType: record.mediaType, bytes: record.bytes });
    context.assertCurrent();
    return JsonValueSchema.parse({ document: source.artifact, readingId: randomUUID(), roster: null, reading: { kind: "subscription" } });
  }
  const rerunParameters = z.strictObject({ run: referenceSchema("R") });
  const runActionParameters = z.strictObject({ run: referenceSchema("R"), action: z.enum(["pause", "resume", "cancel"]) });
  const notificationParameters = z.strictObject({ action: z.enum(["read", "unread", "snooze", "unsnooze"]), target: z.union([z.literal("all"), referenceSchema("N")]) });

  const plugin: AssistantPlugin = { domain: "proposals", tools: [
    { kind: "proposal", tier: "leaves-machine", name: "propose_workflow_start",
      description: "Prepare a card to start one served workflow for 1 to 20 entries; the operator confirms it. Each entry is one line of that workflow's input format (see describe_workflow), or exactly a run reference to reuse that run's input. Use references for people and IDs exactly as given. List every entry the operator asked for; the card shows every row. "
        + "For emergency-contact each entry is exactly an attached PDF reference; the card reads it through OCR.",
      parameters: startParameters,
      async propose(value, context) {
        const { workflow, entries } = startParameters.parse(value), { descriptor } = startable(workflow);
        if (PDF_START_FORMS[workflow] !== undefined) {
          const submissions: JsonValue[] = [];
          for (const entry of entries) submissions.push(await pdfEntry(entry, context));
          const documents = submissions.map(submission => canonicalJsonStringify(z.object({ document: JsonValueSchema }).parse(submission).document));
          if (new Set(documents).size !== documents.length) refuse();
          return planStart(context, { workflowId: workflow, submissions, source: "entries", assertSource() {},
            accepts: planned => planned.length === submissions.length
              && planned.every((run, index) => canonicalJsonStringify(run.rawInput) === canonicalJsonStringify(submissions[index])) });
        }
        const parser = descriptor.surfaces.inputRun?.parser;
        const runs: { runId: string; version: number }[] = [];
        const submissions = entries.map(entry => {
          if (/^\s*\[\[R/u.test(entry)) {
            const reference = context.references.resolve(entry, ["R"]), run = reusableRun(reference.target, workflow);
            if (reference.version !== undefined && reference.version !== run.version) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
            runs.push({ runId: run.envelope.runId, version: run.version });
            return JsonValueSchema.parse(run.input.raw);
          }
          if (parser === undefined) refuse();
          const [parsed, ...rest] = parseInputRunText(parser, context.references.expandArgument(entry, ["E", "P"]));
          if (parsed === undefined || rest.length > 0) refuse();
          return JsonValueSchema.parse(toRawSubmission(parsed));
        });
        const assertSource = () => { for (const run of runs) if (reusableRun(run.runId, workflow).version !== run.version) refuse(); };
        return planStart(context, { workflowId: workflow, submissions, source: runs.length === entries.length && entries.length === 1 ? "run" : "entries", assertSource,
          accepts: planned => planned.length === submissions.length
            && planned.every((run, index) => canonicalJsonStringify(run.rawInput) === canonicalJsonStringify(submissions[index])) });
      } },
    { kind: "proposal", tier: "leaves-machine", name: "propose_rerun",
      description: "Prepare a card to rerun one run with its own input and all of its steps; the operator confirms it. Value changes stay in the Rerun dialog.",
      parameters: rerunParameters,
      async propose(value, context) {
        const reference = context.references.resolve(rerunParameters.parse(value).run, ["R"]);
        const run = requireTrustRun(deps.runs, reference.target);
        if (reference.version !== undefined && reference.version !== run.version) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
        const values = deps.rerunValues({ runId: run.envelope.runId, expectedVersion: run.version });
        if (values.state !== "available") refuse();
        const snapshot = values.snapshot, steps = snapshot.steps.map(step => step.key);
        // The rerun carries the source's own retained input, as the Rerun dialog does; partial or protected sources stay in the dialog.
        if (snapshot.sourceInput.state !== "available") refuse();
        const rerunSource = { runId: snapshot.source.runId, expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys: steps, copiedFrom: [] };
        return planStart(context, { workflowId: snapshot.source.workflow, submissions: [snapshot.sourceInput.value], rerunSource, selectedStepKeys: steps, source: "rerun",
          assertSource: () => { if (requireTrustRun(deps.runs, run.envelope.runId).version !== run.version) refuse(); },
          accepts: planned => planned.length === 1 });
      } },
    { kind: "proposal", tier: "write-local", name: "propose_run_action",
      description: "Prepare a card to pause, resume or cancel one run in the queue; the operator confirms it. The existing run command decides whether the action is allowed.",
      parameters: runActionParameters,
      async propose(value, context) {
        const input = runActionParameters.parse(value), reference = context.references.resolve(input.run, ["R"]);
        const run = requireTrustRun(deps.runs, reference.target);
        if (reference.version !== undefined && reference.version !== run.version) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
        if (hasProtectedSubject(run.input.parsed.protectedBindings)) refuse();
        const descriptor = deps.descriptors.resolve(run.envelope.workflow), label = descriptor?.label ?? run.envelope.workflow;
        const target = { runId: run.envelope.runId, expectedVersion: run.version };
        const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: deps.clock.now().toISOString(), requestedBy: deps.actorId, source: "assistant",
          family: "run", type: input.action, target });
        const row: AssistantProposalRow = { title: run.displayName ?? label, display: plannedRowDisplay(run.envelope.workflow, run.input.parsed) };
        const verb = input.action === "pause" ? "Pause" : input.action === "resume" ? "Resume" : "Cancel";
        return issue(command, context, identity => ({ ...identity, label: `${verb} ${label}`, targetLabel: row.title.slice(0, 160), effect: "run-action", action: input.action,
          workflowId: run.envelope.workflow, run: target, row }), {
          assertCurrent() { if (requireTrustRun(deps.runs, run.envelope.runId).version !== run.version) refuse(); } });
      } },
    { kind: "change", tier: "write-local", name: "change_notifications",
      description: "Mark notifications read or unread, or snooze or unsnooze them: all current ones, or one notification reference. It applies at once, with no card; tell the operator what changed.",
      parameters: notificationParameters, output: ChangeOutput, privacy: [],
      async invoke(value, context) {
        const input = notificationParameters.parse(value);
        let command: CommandRequest, count: number, assertCurrent: () => void;
        if (input.target === "all") {
          const operation: NotificationCollectionOperation = NotificationCollectionOperationSchema.parse(input.action);
          const observe = () => deps.database.authority.notifications.collection(context.actorId, operation);
          const target = deps.database.withAuthorityReadSnapshot(observe);
          if (target.matchingCount === 0) refuse();
          command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: deps.clock.now().toISOString(), requestedBy: deps.actorId, source: "assistant",
            family: "notification", type: `${NOTIFICATION_ACTIONS[input.action]}-all`, target });
          count = target.matchingCount;
          assertCurrent = () => { if (canonicalJsonStringify(observe()) !== canonicalJsonStringify(target)) refuse(); };
        } else {
          const id = context.references.resolve(input.target, ["N"]).target, record = deps.database.authority.notifications.get(id);
          if (record === undefined || record.actorId !== context.actorId) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
          command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: deps.clock.now().toISOString(), requestedBy: deps.actorId, source: "assistant",
            family: "notification", type: NOTIFICATION_ACTIONS[input.action], target: { notificationId: record.notificationId, actorId: record.actorId, expectedVersion: record.version } });
          count = 1;
          assertCurrent = () => { if (deps.database.authority.notifications.get(id)?.version !== record.version) refuse(); };
        }
        context.assertCurrent();
        // Confirm applies only to runs: a small local change is approved by policy and consumed in the same transaction as its currentness check.
        const chat = deps.authorization.createChat(), prepared = deps.authorization.prepare(chat, command);
        deps.authorization.approve(chat, prepared.id, prepared.revision);
        const result = deps.database.withAuthorityTransaction(() => { assertCurrent(); return deps.authorization.consume(chat, prepared.id); });
        if (result !== null) deps.commands.publish(command, result);
        if (result?.state !== "applied") refuse();
        return { state: "applied", count };
      } },
    spreadsheets.tool,
  ] };

  return Object.freeze({
    plugin,
    /** Confirm or Cancel one issued card: identity, revision, expiry and the reviewed digest first; one claim; UNKNOWN is never retried. */
    async decideAction(decision: AssistantActionDecision, signal: AbortSignal): Promise<AssistantActionResult> {
      signal.throwIfAborted(); deps.assertCurrent();
      if (spreadsheets.has(decision.actionId)) return spreadsheets.decide(decision, signal);
      const issued = pending.get(decision.actionId);
      if (issued === undefined || issued.chat.chatId !== decision.chatId || issued.revision !== decision.revision) throw new Error("assistant-action-not-current");
      if (Date.parse(issued.expiresAt) <= deps.clock.nowMs()) throw new AssistantToolRefusal("ASSISTANT_PROPOSAL_EXPIRED");
      issued.assertCurrent();
      if (canonicalJsonStringify(deps.database.authority.assistantAuthorization.action(decision.actionId)) !== canonicalJsonStringify(issued.record)) throw new Error("assistant-action-record-stale");
      const caption = (text: string, modelText?: string) => deps.database.authority.assistantHistory.appendDecision({ conversationId: issued.conversationId, actionId: decision.actionId,
        messageId: randomUUID(), text, ...(modelText === undefined ? {} : { modelText }), now: deps.clock.now().toISOString() });
      if (decision.decision === "cancel") {
        pending.delete(decision.actionId);
        deps.authorization.cancel(issued.chat, decision.actionId, decision.revision);
        // Before a claim a lost caption leaves the result as is; the panel sees the missing caption on readback.
        try { caption(`Not done: ${issued.label}.`); } catch { /* readback shows the caption is missing */ }
        return { state: "cancelled", actionId: decision.actionId };
      }
      if (decision.reviewedDigest !== issued.digest) throw new Error("assistant-reviewed-proposal-mismatch");
      pending.delete(decision.actionId);
      deps.authorization.approve(issued.chat, decision.actionId, decision.revision);
      const notDone = `Not done: ${issued.label}. ${ASSISTANT_FAILURES.ASSISTANT_PROPOSAL_REFUSED}`;
      // After the claim every failure, including this Confirm's own abort, is UNKNOWN: the action is spent and never retried.
      try {
        const current = () => { signal.throwIfAborted(); issued.assertCurrent(); };
        let result = issued.start
          ? await deps.authorization.consumeStart(issued.chat, decision.actionId, current, command => deps.commands.submit(command))
          : deps.authorization.consume(issued.chat, decision.actionId);
        if (!issued.start && result !== null) {
          result = await deps.commands.completeConsumed(issued.record.command, result);
          deps.commands.publish(issued.record.command, result);
        }
        signal.throwIfAborted();
        if (result?.state !== "applied") {
          caption(notDone);
          return { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" };
        }
        issued.assertApplied();
        caption(`Done: ${issued.label}.${result.workerStartup === undefined ? "" : ` ${result.workerStartup.message}`}`);
        return { state: "applied", actionId: decision.actionId };
      } catch {
        try { caption(ERROR_CATALOG.ASSISTANT_OUTCOME_UNKNOWN.text, `Outcome unknown: ${issued.label}. Do not retry.`); } catch { /* the action stays UNKNOWN either way */ }
        return { state: "unknown", actionId: decision.actionId };
      }
    },
  });
}
