import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ASSISTANT_START_ROWS_MAX, AssistantAcceptedTurnSchema, AssistantM2ProposalSnapshotSchema, assistantM2ProposalDigest, type AssistantAcceptedTurn,
  type AssistantM2ProposalOptions, type AssistantM2ProposalRecord, type AssistantM2ProposalRow, type AssistantM2ProposalSnapshot, type AssistantReplyPart } from "../../models/dashboard/assistant.js";
import type { RerunValuesResponse } from "../../models/dashboard/rerun-values.js";
import { ErrorCatalogCodeSchema } from "../../models/failures/error-catalog.js";
import { parseInputRunText, toRawSubmission } from "../../models/workflow/ingress.js";
import { AssistantCommandAttributionSchema, CommandRequestSchema, StartCommandRequestSchema, type CommandRequest, type CommandResult } from "../../rules/commands/commands.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import type { Clock } from "../../rules/time/clock.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../rules/validation/canonical-json.js";
import { workflowDryRunSupport, type AnyWorkflowDescriptor } from "../../workflow-kit/workflow.js";
import type { OcrSourceService } from "../runs/commands/ocr-source-service.js";
import type { StartPlanService } from "../runs/commands/start-plan-service.js";
import type { RunRecordService } from "../runs/lifecycle/run-record-service.js";
import { hasProtectedSubject } from "../runs/start/protected-input.js";
import { requireTrustRun } from "../runs/trust/run-reader.js";
import type { AssistantM1Attempt } from "../storage/sqlite/assistant-history.js";
import type { AssistantProposalRepository } from "../storage/sqlite/assistant-proposals.js";
import { AssistantAuthorizationError } from "./authorization.js";
import { AssistantToolRefusal, referenceSchema, type AssistantPlugin, type AssistantProposalDraft, type AssistantToolContext, type AssistantTypedProposalTool } from "./plugins/plugin.js";
import type { AssistantPluginDeps } from "./plugins/registry.js";
import { plannedRowDisplay } from "./proposals.js";
import { assistantSessionPart } from "./replies.js";

const TYPED_YES = new Set(["yes", "yes file it", "approve", "go ahead", "do it"]);
/** Relay's typed yes: case, spacing and `. , !` are ignored; any other wording, `yes, but…` included, is a change request for the model. */
export function isTypedYes(text: string): boolean {
  return TYPED_YES.has(text.normalize("NFKC").toLowerCase().replace(/[.,!]/gu, " ").replace(/\s+/gu, " ").trim());
}

/** How a proposal reads in its reply: what will happen, one bullet per row, and the yes it waits for. */
export function assistantProposalParts(draft: AssistantProposalDraft): AssistantReplyPart[] {
  return [
    { kind: "text", runs: [{ kind: "bold", text: draft.dryRun ? `${draft.label} (dry run)` : draft.label }] },
    { kind: "bullets", items: draft.rows.map(row => [{ kind: "value", value: row.title }, ...(row.subtitle === undefined ? [] : [{ kind: "plain" as const, text: ` · ${row.subtitle}` }])]) },
    { kind: "text", runs: [{ kind: "plain", text: "Reply yes to go ahead." }] },
  ];
}

export const AssistantProposalToolOutputSchema = z.strictObject({ status: z.literal("awaiting-yes"), count: z.number().int().min(1).max(ASSISTANT_START_ROWS_MAX) });

export interface AssistantTypedProposalPorts {
  readonly store: Pick<AssistantProposalRepository, "issue" | "open" | "read" | "claimAnswer" | "supersede" | "claimRow" | "settleRow" | "hasRowCommand">;
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  served(workflowId: string): boolean;
  readonly plans: Pick<StartPlanService, "prepare" | "plan">;
  /** The stored plan's planned canonical and raw inputs, in order. */
  plannedInputs(startPlanId: string): readonly Readonly<{ input: unknown; rawInput: unknown }>[] | undefined;
  readonly runs: Pick<RunRecordService, "read">;
  readonly rerunValues: (request: unknown) => RerunValuesResponse;
  readonly attachment: AssistantPluginDeps["attachment"];
  /** Registers an attached PDF as an OCR source; a local write, like preparing a plan. */
  ocrSources(): Pick<OcrSourceService, "upload">;
  /** Submits one row's command; composition records the attribution with its audit. */
  submit(command: CommandRequest, attribution: z.infer<typeof AssistantCommandAttributionSchema>): Promise<CommandResult>;
  browserMode(): "headless" | "headed";
  current(): { readonly profileId: string; readonly epoch: number };
  readonly clock: Clock;
  readonly actorId: string;
}

function refuse(): never { throw new AssistantToolRefusal("ASSISTANT_PROPOSAL_REFUSED"); }
const same = (left: unknown, right: unknown) => canonicalJsonStringify(JsonValueSchema.parse(left)) === canonicalJsonStringify(JsonValueSchema.parse(right));
/** Workflows whose one input is an attached PDF of a fixed OCR form. */
const PDF_START_WORKFLOWS = new Set(["emergency-contact"]);
type StartOptions = Omit<AssistantM2ProposalOptions, "priority"> & Partial<Pick<AssistantM2ProposalOptions, "priority">>;
type Rerun = Readonly<{ source: JsonValue; steps: readonly string[] }>;

/** Typed-yes proposals: tools that record what the operator will review, and the one owner that runs a reviewed proposal's rows after its typed yes. */
export function createAssistantTypedProposals(ports: AssistantTypedProposalPorts) {
  const active = new Map<string, Readonly<{ command: CommandRequest; check: () => void }>>();
  const now = () => ports.clock.now().toISOString();

  function startable(workflowId: string, dryRun: boolean) {
    const descriptor = ports.descriptors.resolve(workflowId);
    if (descriptor === undefined || !ports.served(descriptor.id) || (dryRun && workflowDryRunSupport(descriptor).state !== "supported")) refuse();
    return descriptor;
  }
  /** One row's own plan with the reviewed options; refuses anything beyond exactly that row. */
  async function planOne(descriptor: AnyWorkflowDescriptor, submission: JsonValue, dryRun: boolean, options: StartOptions, signal: AbortSignal, rerun?: Rerun) {
    const request = { workflowId: descriptor.id, submissions: [submission], dryRun, browserMode: options.browserMode, captureBrowserScreenshots: options.captureBrowserScreenshots,
      // Required workbooks (the OCR roster) use each type's default workbook, as the Run dialog does without a pick.
      ...(descriptor.requiredWorkbookTypeIds.length === 0 ? {} : { workbookReferences: descriptor.requiredWorkbookTypeIds.map(typeId => ({ entry: 1, typeId })) }),
      ...(rerun === undefined ? {} : { rerunSource: rerun.source, selectedStepKeys: [...rerun.steps] }) };
    await ports.plans.prepare?.(request, signal);
    const planned = ports.plans.plan(request), [row] = planned.planned, inputs = ports.plannedInputs(planned.startPlanId), [stored] = inputs ?? [];
    if (row === undefined || stored === undefined || planned.workflowId !== descriptor.id || planned.dryRun !== dryRun || planned.planned.length !== 1 || inputs?.length !== 1
      || planned.refused.length > 0 || planned.omittedSteps !== undefined || (rerun === undefined) !== (planned.rerun === undefined)
      || planned.browserMode !== options.browserMode || planned.captureBrowserScreenshots !== options.captureBrowserScreenshots
      || (options.priority !== undefined && planned.priority !== options.priority) || (rerun === undefined && !same(stored.rawInput, submission))) refuse();
    return { planned, row, input: stored.input };
  }
  function reusableRun(runId: string, workflowId: string) {
    const run = requireTrustRun(ports.runs, runId), descriptor = ports.descriptors.resolve(run.envelope.workflow);
    if (run.envelope.workflow !== workflowId || !ports.served(workflowId) || hasProtectedSubject(run.input.parsed.protectedBindings) || descriptor === undefined
      || descriptor.version !== run.envelope.descriptorVersion || descriptor.contractFingerprint !== run.envelope.contractFingerprint) refuse();
    return run;
  }
  async function pdfEntry(entry: string, context: AssistantToolContext) {
    const record = ports.attachment(context.conversationId, context.references.resolve(entry, ["A"]).target);
    if (record === undefined) throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNAVAILABLE");
    if (record.mediaType !== "application/pdf") throw new AssistantToolRefusal("ASSISTANT_ATTACHMENT_UNSUPPORTED");
    context.assertCurrent();
    const source = await ports.ocrSources().upload({ actorId: ports.actorId, fileName: record.name, mediaType: record.mediaType, bytes: record.bytes });
    context.assertCurrent();
    return { submission: JsonValueSchema.parse({ document: source.artifact, readingId: randomUUID(), roster: null, reading: { kind: "subscription" } }), fileName: record.name };
  }
  async function entrySubmissions(descriptor: AnyWorkflowDescriptor, entries: readonly string[], context: AssistantToolContext): Promise<readonly Readonly<{ submission: JsonValue; fileName?: string }>[]> {
    if (PDF_START_WORKFLOWS.has(descriptor.id)) {
      const files: Awaited<ReturnType<typeof pdfEntry>>[] = [];
      for (const entry of entries) files.push(await pdfEntry(entry, context));
      return files;
    }
    const parser = descriptor.surfaces.inputRun?.parser;
    return entries.map(entry => {
      if (/^\s*\[\[R/u.test(entry)) {
        const reference = context.references.resolve(entry, ["R"]), run = reusableRun(reference.target, descriptor.id);
        if (reference.version !== undefined && reference.version !== run.version) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
        return { submission: JsonValueSchema.parse(run.input.raw) };
      }
      const [parsed, ...rest] = parser === undefined ? [] : parseInputRunText(parser, context.references.expandArgument(entry, ["E", "P"]));
      if (parsed === undefined || rest.length > 0) refuse();
      return { submission: JsonValueSchema.parse(toRawSubmission(parsed)) };
    });
  }
  /** The source run's own retained input and all of its steps, as the Rerun dialog reruns it. */
  function rerunSource(run: ReturnType<typeof requireTrustRun>) {
    const values = ports.rerunValues({ runId: run.envelope.runId, expectedVersion: run.version });
    if (values.state !== "available") refuse();
    const { snapshot } = values, input = snapshot.sourceInput, steps = snapshot.steps.map(step => step.key);
    if (input.state !== "available") refuse();
    return { workflowId: snapshot.source.workflow, submission: JsonValueSchema.parse(input.value),
      rerun: { source: JsonValueSchema.parse({ runId: snapshot.source.runId, expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys: steps, copiedFrom: [] }), steps } };
  }
  function referencedRun(value: string, context: AssistantToolContext) {
    const reference = context.references.resolve(value, ["R"]), run = requireTrustRun(ports.runs, reference.target);
    if (reference.version !== undefined && reference.version !== run.version) throw new AssistantToolRefusal("ASSISTANT_READ_STALE");
    return run;
  }
  const label = (workflowId: string) => ports.descriptors.resolve(workflowId)?.label ?? workflowId;

  const startParameters = z.strictObject({ workflow: z.string().min(1).max(80), entries: z.array(z.string().min(1).max(400)).min(1).max(ASSISTANT_START_ROWS_MAX), dryRun: z.boolean() });
  const rerunParameters = z.strictObject({ run: referenceSchema("R"), dryRun: z.boolean() });
  const runActionParameters = z.strictObject({ run: referenceSchema("R"), action: z.enum(["pause", "resume", "cancel"]) });
  const tool = (name: string, tier: "write-local" | "leaves-machine", description: string, parameters: z.ZodType, prepare: AssistantTypedProposalTool["prepare"]): AssistantTypedProposalTool =>
    ({ kind: "typed-proposal", tier, name, description, parameters, output: AssistantProposalToolOutputSchema, privacy: [], prepare });
  const ask = " Relay shows the operator what it will do; it runs only after the operator replies yes. Say what you proposed and stop.";

  const plugin: AssistantPlugin = { domain: "proposals", tools: [
    tool("propose_workflow_start", "leaves-machine", "Propose starting one served workflow for 1 to 20 entries. Each entry is one line of that workflow's input format (see describe_workflow), or exactly a run reference to reuse that run's input; "
      + "for emergency-contact each entry is exactly an attached PDF reference. Use references exactly as given and list every entry asked for. dryRun is true only when the operator asked for a dry run; otherwise the run saves for real." + ask,
    startParameters, async (value, context) => {
      const { workflow, entries, dryRun } = startParameters.parse(value), descriptor = startable(workflow, dryRun);
      const sources = await entrySubmissions(descriptor, entries, context);
      if (new Set(sources.map(entry => canonicalJsonStringify(entry.submission))).size !== sources.length) refuse();
      const options = { browserMode: ports.browserMode(), captureBrowserScreenshots: true }, priorities = new Set<AssistantM2ProposalOptions["priority"]>();
      const rows: AssistantProposalDraft["rows"][number][] = [];
      for (const entry of sources) {
        context.assertCurrent();
        const { planned, row, input } = await planOne(descriptor, entry.submission, dryRun, options, context.signal);
        priorities.add(planned.priority);
        rows.push({ title: row.title, ...(row.subtitle === undefined ? {} : { subtitle: row.subtitle }),
          display: plannedRowDisplay(descriptor.id, input, () => entry.fileName),
          operation: { kind: "workflow-start", workflowId: descriptor.id, submission: entry.submission, expected: planned.fingerprints } });
      }
      const [priority] = priorities;
      if (priority === undefined || priorities.size !== 1) refuse();
      context.assertCurrent();
      return { label: `Start ${descriptor.label}`, dryRun, options: { ...options, priority }, rows };
    }),
    tool("propose_rerun", "leaves-machine", "Propose rerunning one run with its own input and all of its steps. Value changes stay in the Rerun dialog. dryRun is true only when the operator asked for a dry run." + ask,
      rerunParameters, async (value, context) => {
        const { run: reference, dryRun } = rerunParameters.parse(value), run = referencedRun(reference, context), source = rerunSource(run), descriptor = startable(source.workflowId, dryRun);
        const options = { browserMode: ports.browserMode(), captureBrowserScreenshots: true };
        const { planned } = await planOne(descriptor, source.submission, dryRun, options, context.signal, source.rerun);
        context.assertCurrent();
        return { label: `Rerun ${descriptor.label}`, dryRun, options: { ...options, priority: planned.priority }, rows: [{ title: run.displayName ?? descriptor.label,
          display: plannedRowDisplay(run.envelope.workflow, run.input.parsed), operation: { kind: "rerun", runId: run.envelope.runId, expectedVersion: run.version, selectedStepKeys: source.rerun.steps } }] };
      }),
    tool("propose_run_action", "write-local", "Propose pausing, resuming or cancelling one run in the queue. The existing run command decides whether the action is allowed." + ask,
      runActionParameters, (value, context) => {
        const input = runActionParameters.parse(value), run = referencedRun(input.run, context);
        if (hasProtectedSubject(run.input.parsed.protectedBindings)) refuse();
        const verb = input.action === "pause" ? "Pause" : input.action === "resume" ? "Resume" : "Cancel", workflow = label(run.envelope.workflow);
        return Promise.resolve({ label: `${verb} ${workflow}`, dryRun: false, options: null, rows: [{ title: run.displayName ?? workflow, display: plannedRowDisplay(run.envelope.workflow, run.input.parsed),
          operation: { kind: "run-action", runId: run.envelope.runId, expectedVersion: run.version, action: input.action } }] });
      }),
  ] };

  /** The command a reviewed row issues now: fresh plans and runs must still match what the operator reviewed. */
  async function rowCommand(snapshot: AssistantM2ProposalSnapshot, row: AssistantM2ProposalRow, signal: AbortSignal): Promise<CommandRequest> {
    const identity = { commandId: randomUUID(), requestedAt: now(), requestedBy: ports.actorId, source: "assistant" as const };
    const { operation } = row;
    if (operation.kind === "run-action") {
      const run = requireTrustRun(ports.runs, operation.runId);
      if (run.version !== operation.expectedVersion || hasProtectedSubject(run.input.parsed.protectedBindings)) refuse();
      return CommandRequestSchema.parse({ ...identity, family: "run", type: operation.action, target: { runId: operation.runId, expectedVersion: operation.expectedVersion } });
    }
    if (snapshot.options === null) refuse();
    let planned: Awaited<ReturnType<typeof planOne>>["planned"];
    if (operation.kind === "workflow-start") {
      ({ planned } = await planOne(startable(operation.workflowId, snapshot.dryRun), operation.submission, snapshot.dryRun, snapshot.options, signal));
      if (!same(planned.fingerprints, operation.expected)) refuse();
    } else {
      const run = requireTrustRun(ports.runs, operation.runId);
      if (run.version !== operation.expectedVersion) refuse();
      const source = rerunSource(run);
      if (!same(source.rerun.steps, operation.selectedStepKeys)) refuse();
      ({ planned } = await planOne(startable(source.workflowId, snapshot.dryRun), source.submission, snapshot.dryRun, snapshot.options, signal, source.rerun));
    }
    return StartCommandRequestSchema.parse({ ...identity, family: "start", type: "start-run",
      target: { workflowId: planned.workflowId, startPlanId: planned.startPlanId, expectedVersion: planned.expectedVersion }, payload: planned.fingerprints });
  }
  const attribution = (turn: AssistantAcceptedTurn, snapshot: AssistantM2ProposalSnapshot, row: AssistantM2ProposalRow) => AssistantCommandAttributionSchema.parse({ kind: "assistant",
    requestedBy: ports.actorId, profileId: turn.profileId, conversationId: turn.conversationId, acceptedMessageId: turn.messageId,
    binding: { kind: "proposal", proposalId: snapshot.id, rowId: row.id } });
  const refusalCode = (error: unknown) => ErrorCatalogCodeSchema.safeParse(error instanceof AssistantToolRefusal || error instanceof AssistantAuthorizationError ? error.code : undefined).data
    ?? "ASSISTANT_PROPOSAL_REFUSED";

  /** One row: a refusal before its claim leaves nothing behind; after its claim every failure is UNKNOWN and never retried. */
  async function runRow(turn: AssistantAcceptedTurn, snapshot: AssistantM2ProposalSnapshot, row: AssistantM2ProposalRow, check: () => void, signal: AbortSignal) {
    let command: CommandRequest;
    try {
      check();
      command = await rowCommand(snapshot, row, signal);
      check();
    } catch (error) {
      ports.store.settleRow(snapshot.id, row.id, { state: "refused", code: refusalCode(error), commandId: null });
      return;
    }
    const { commandId } = command;
    if (!ports.store.claimRow(snapshot.id, row.id, commandId)) return;
    active.set(commandId, { command, check });
    let result: CommandResult;
    try { result = await ports.submit(command, attribution(turn, snapshot, row)); }
    catch { ports.store.settleRow(snapshot.id, row.id, { state: "unknown", commandId }); return; }
    finally { active.delete(commandId); }
    const runIds = result.state !== "applied" ? [] : row.operation.kind === "run-action" ? [row.operation.runId]
      : result.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
    if (result.state === "applied" && runIds.length === 1) ports.store.settleRow(snapshot.id, row.id, { state: "applied", commandId, runIds });
    // Rejected, conflicting or confirmation-required commands did not apply; anything else is not proved either way.
    else if (result.state === "rejected" || result.state === "conflict" || result.state === "confirmation-required") ports.store.settleRow(snapshot.id, row.id, { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED", commandId });
    else ports.store.settleRow(snapshot.id, row.id, { state: "unknown", commandId });
  }

  /** The answered reply, read back from each row's stored result: Done, Not done, or Couldn't finish this. */
  function answerReply(turn: AssistantAcceptedTurn, record: AssistantM2ProposalRecord) {
    const { snapshot } = record, [first] = snapshot.rows;
    if (first === undefined) refuse();
    const parts: AssistantReplyPart[] = [{ kind: "answered", attribution: attribution(turn, snapshot, first), at: IsoInstantSchema.parse(now()) }], lines: string[] = [];
    const text = (line: string) => { parts.push({ kind: "text", runs: [{ kind: "plain", text: line }] }); lines.push(line); };
    snapshot.rows.forEach((row, index) => {
      const result = record.rows[index]?.result;
      if (result?.state === "applied" && row.operation.kind !== "run-action") {
        lines.push(`Done: ${row.title}.`);
        const workflowId = row.operation.kind === "workflow-start" ? row.operation.workflowId : requireTrustRun(ports.runs, row.operation.runId).envelope.workflow;
        for (const runId of result.runIds) parts.push(assistantSessionPart(requireTrustRun(ports.runs, runId), label(workflowId)));
      } else if (result?.state === "applied") text(`Done: ${row.title}.`);
      else if (result?.state === "refused" || result?.state === "not-started") text(`Not done: ${row.title}.`);
      else text(`Couldn't finish this: ${row.title}. Check it before trying again.`);
    });
    return { parts, modelText: `The operator replied yes to: ${snapshot.label}${snapshot.dryRun ? " (dry run)" : ""}. ${lines.join(" ")}` };
  }

  return Object.freeze({
    plugin,
    open: (conversationId: string) => ports.store.open(conversationId),
    supersede: (conversationId: string) => { ports.store.supersede(conversationId); },
    /** Records the draft rendered in `renderedMessageId`, the reply to `sourceMessageId`. */
    issue(draft: AssistantProposalDraft, at: Readonly<{ conversationId: string; renderedMessageId: string; sourceMessageId: string; revision: number }>) {
      const base = { id: randomUUID(), profileId: ports.current().profileId, ...at, label: draft.label, dryRun: draft.dryRun, options: draft.options, createdAt: now(),
        rows: draft.rows.map((row, index) => ({ ...row, id: randomUUID(), ordinal: index + 1 })) };
      return ports.store.issue(AssistantM2ProposalSnapshotSchema.parse({ ...base, renderedDigest: assistantM2ProposalDigest(base) }));
    },
    /** Runs the proposal this accepted typed yes answers, row by row, each under its own claim; the model takes no part. */
    async answer(attempt: AssistantM1Attempt, signal: AbortSignal, assertCurrent: () => void) {
      const turn = AssistantAcceptedTurnSchema.parse(attempt.acceptedTurn), bound = turn.proposalAnswer, shown = bound === null ? undefined : ports.store.read(bound.proposalId);
      if (bound === null || shown === undefined) refuse();
      const check = () => {
        assertCurrent();
        const owner = ports.current();
        if (owner.profileId !== turn.profileId || owner.epoch !== turn.epoch) throw new AssistantAuthorizationError("assistant-proposal-owner-stale");
      };
      check();
      if (!ports.store.claimAnswer({ ...bound, attempt, now: now() })) refuse();
      for (const row of shown.snapshot.rows) await runRow(turn, shown.snapshot, row, check, signal);
      return answerReply(turn, ports.store.read(shown.snapshot.id) ?? refuse());
    },
    /** The command effect hook: a proposal row's command runs only inside its own claim, unchanged, for a still-current turn. */
    assertEffect(commandId: string, command?: CommandRequest): void {
      const entry = active.get(commandId);
      if (entry === undefined) {
        if (ports.store.hasRowCommand(commandId)) throw new AssistantAuthorizationError("assistant-effect-custody-unproved", "ASSISTANT_UNKNOWN_NOT_REPLAYABLE");
        return;
      }
      if (command !== undefined && !same(entry.command, command)) throw new AssistantAuthorizationError("assistant-command-binding-mismatch", "ASSISTANT_PROPOSAL_MISMATCH");
      entry.check();
    },
  });
}
export type AssistantTypedProposals = ReturnType<typeof createAssistantTypedProposals>;
