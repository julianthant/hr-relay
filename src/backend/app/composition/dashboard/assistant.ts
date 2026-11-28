import { AssistantAuthorizationError, createAssistantSessionAuthorization } from '../../../assistant/authorization.js';
import type { AssistantPlugin } from '../../../assistant/plugins/plugin.js';
import { sessionsPlugin } from '../../../assistant/plugins/sessions/index.js';
import { createAssistantM1Service, type AssistantM1ServiceOptions } from '../../../assistant/service.js';
import { createAssistantTypedProposals, type AssistantTypedProposalPorts } from '../../../assistant/typed-proposals.js';
import type { AssistantReferenceTable } from '../../../assistant/references.js';
import type { ServerReplyBinding } from '../../../assistant/replies.js';
import { selectActiveRunSettings } from '../../../runs/settings/run-settings.js';
import type { CommandRequest, CommandResult } from '../../../../rules/commands/commands.js';
import { CrossDateSearchQuerySchema, SearchCoverageSchema } from '../../../../models/dashboard/search.js';
import { buildRunDetail, type RunDetailQueryDeps } from '../../../runs/queries/run-detail.js';
import type { CrossDateSearchQueryService } from '../../../runs/queries/search.js';
import { readSettings } from '../../../runtime/settings/settings-runtime.js';
import type { AuthorityDatabase } from '../../../storage/sqlite/authority-database.js';
import { createAssistantEditApply, type AssistantEditOwner, type LocalEditCommand } from '../../../assistant/applied-edits.js';
import { canonicalJsonStringify } from '../../../../rules/validation/canonical-json.js';
import type { AssistantPluginDeps } from '../../../assistant/plugins/registry.js';
import type { AssistantWorkflowFacts } from '../../../assistant/plugins/workflows/facts.js';
import type { NotificationWire } from '../../../../models/dashboard/projection.js';
import type { WorkbookLibraryService } from '../../../workbooks/workbook-library-service.js';
import type { Clock } from '../../../../rules/time/clock.js';
import type { RunRecordService } from '../../../runs/lifecycle/run-record-service.js';
import type { RunRecord } from '../../../../models/run/record.js';
import { PersonLookupCanonicalInput, personLookupWorkflow } from '../../../../workflows/person-lookup/workflow.js';
import { directIdentifierDisplay } from '../../../../rules/redaction/redaction.js';
import { parseCanonicalInputSnapshot } from '../../../../models/workflow/canonical-input.js';
import { searchPartitionDay } from '../../../../models/dashboard/search-calendar.js';
import { EidSchema } from '../../../../rules/identity/ids.js';
import { AssistantToolRefusal } from '../../../assistant/plugins/plugin.js';
import { hasProtectedSubject, protectedSubjectDisplay } from '../../../runs/start/protected-input.js';

function lookupEid(row: RunRecord): string | undefined {
  if (row.envelope.workflow !== personLookupWorkflow.id || (row.envelope.shape !== 'single' && row.envelope.shape !== 'operation-member')
    || hasProtectedSubject(row.input.parsed.protectedBindings)) return undefined;
  try {
    const input = parseCanonicalInputSnapshot(PersonLookupCanonicalInput, row.input.parsed);
    return input.mode === 'search' && 'emplId' in input ? input.emplId : undefined;
  } catch { throw new AssistantToolRefusal('ASSISTANT_READ_UNAVAILABLE'); }
}

export function createAssistantPluginDeps(options: Readonly<{
  database: Pick<AuthorityDatabase, 'authority' | 'withAuthorityReadSnapshot'>;
  runDetail: RunDetailQueryDeps;
  runs: Pick<RunRecordService, 'list' | 'read'>;
  search: () => CrossDateSearchQueryService;
  notifications: () => { snapshot(actor: string): readonly NotificationWire[] };
  workbooks: () => Pick<WorkbookLibraryService, 'catalog' | 'read' | 'types'>;
  attachment: AssistantPluginDeps['attachment'];
  edits?: AssistantEditOwner;
  clock?: Clock;
  facts: () => AssistantWorkflowFacts;
  assertCurrent(): void;
}>): AssistantPluginDeps {
  const current = <T>(read: () => T): T => { options.assertCurrent(); const value = read(); options.assertCurrent(); return value; };
  const { clock } = options;
  const label = (row: RunRecord) => protectedSubjectDisplay(row.input.parsed.protectedBindings, () => {
    const eid = lookupEid(row), workflow = options.facts().facts.find(fact => fact.id === row.envelope.workflow)?.label ?? row.envelope.workflow;
    return { title: `${workflow}${row.runNumber === undefined ? '' : ` #${String(row.runNumber)}`}${eid === undefined ? '' : ` · EID ${directIdentifierDisplay(eid)}`} · ${row.envelope.enqueuedAt} · attempt ${String(row.envelope.attempt)}` };
  }).title;
  return {
    findLookupRuns: eid => current(() => options.database.withAuthorityReadSnapshot(() => {
      const exact = EidSchema.parse(eid), matches: RunRecord[] = [];
      let cursor: Parameters<RunRecordService['list']>[0]['cursor'];
      let scanned = 0;
      do {
        const page = options.runs.list({ workflow: personLookupWorkflow.id, disposition: 'live', limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
        if (page.state !== 'listed') throw new AssistantToolRefusal('ASSISTANT_READ_STALE');
        scanned += page.rows.length;
        for (const row of page.rows) if (lookupEid(row) === exact) matches.push(row);
        cursor = page.cursor;
        if (cursor !== undefined && scanned >= SearchCoverageSchema.shape.candidateLimit.value) throw new AssistantToolRefusal('ASSISTANT_LIMIT');
      } while (cursor !== undefined);
      return matches.sort((a, b) => Date.parse(b.envelope.enqueuedAt) - Date.parse(a.envelope.enqueuedAt) || a.envelope.runId.localeCompare(b.envelope.runId))
        .map(row => ({ runId: row.envelope.runId, version: row.version, day: searchPartitionDay(new Date(row.envelope.enqueuedAt)),
          status: row.lifecycle.state === 'terminal' ? row.lifecycle.outcome : row.lifecycle.state, label: label(row) }));
    })),
    runReferenceLabel: (runId, expectedVersion) => current(() => options.database.withAuthorityReadSnapshot(() => {
      const current = options.runs.read(runId);
      if (current.state !== 'present' || current.disposition !== 'live' || current.run.version !== expectedVersion) throw new AssistantToolRefusal('ASSISTANT_READ_STALE');
      return label(current.run);
    })),
    search: query => current(() => options.search().search(CrossDateSearchQuerySchema.parse(query))),
    runDetail: runId => current(() => buildRunDetail(options.runDetail, runId)),
    notifications: actor => current(() => options.notifications().snapshot(actor)),
    workbooks: () => { const library = options.workbooks();
      return { catalog: () => current(() => library.catalog()), read: libraryId => current(() => library.read(libraryId)), types: () => current(() => library.types()) }; },
    attachment: (conversationId, id) => current(() => options.attachment(conversationId, id)),
    settings: () => current(() => options.database.withAuthorityReadSnapshot(() => readSettings(options.database.authority).settings)),
    ...(options.edits === undefined ? {} : { edits: options.edits,
      settingsRecord: () => current(() => options.database.withAuthorityReadSnapshot(() => readSettings(options.database.authority))) }),
    ...(clock === undefined ? {} : { appliedEdits: { clock, list: (since: string) => current(() => options.database.authority.assistantAppliedEdits.list(since)) } }),
    facts: options.facts,
  };
}
export function assistantSurfaceCoverage(routes: readonly Readonly<{ method: string; path: string }>[]) {
  const actions = new Map<string, Readonly<{ method: string; path: string; availability: "handoff"; reason: "operator-interface-required" }>>();
  for (const route of routes) {
    if (route.method === "ALL") continue;
    const key = `${route.method} ${route.path}`;
    actions.set(key, { method: route.method, path: route.path, availability: "handoff", reason: "operator-interface-required" });
  }
  return [...actions.values()].sort((a, b) => {
    const left = `${a.method} ${a.path}`, right = `${b.method} ${b.path}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Reclaims expired chats every interval; each failed tick is reported and the next tick retries. */
export function startAssistantHistoryCleanup(reclaim: () => void, report: (error: unknown) => void, intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => { try { reclaim(); } catch (error) { report(error); } }, intervalMs);
  timer.unref();
  return timer;
}

/** Every reference this turn issued renders as its local display text. */
export const assistantValueBindings = (table: AssistantReferenceTable): readonly ServerReplyBinding[] =>
  table.issued().map(([reference, entry]) => ({ kind: 'value-only' as const, reference, entry, value: entry.display }));

/** Whether `attribution` names the stored claim of `command`: its session claim, or the claimed proposal row in the same chat. */
export function attributionOwnsCommand(store: AuthorityDatabase['authority']['assistantProposals'], command: CommandRequest,
  attribution: Parameters<AssistantTypedProposalPorts['submit']>[1], profileId: string): boolean {
  if (attribution.kind !== 'assistant' || command.source !== 'assistant' || attribution.requestedBy !== command.requestedBy || attribution.profileId !== profileId) return false;
  const { binding } = attribution;
  if (binding.kind === 'proposal') {
    const record = store.read(binding.proposalId), row = record?.rows.find(entry => entry.rowId === binding.rowId);
    return record?.snapshot.conversationId === attribution.conversationId && record.lifecycle.state === 'answered' && record.lifecycle.answerMessageId === attribution.acceptedMessageId
      && row?.result.state === 'claimed' && row.result.commandId === command.commandId;
  }
  const claimed = store.sessions.byCommand(command.commandId)?.claim;
  return claimed !== undefined && claimed.actionId === binding.actionId && claimed.acceptedTurn.conversationId === attribution.conversationId
    && claimed.acceptedTurn.messageId === attribution.acceptedMessageId;
}

/** The served assistant: the turn-accounting service over the typed-yes proposal owner and read-only sessions. */
export function composeAssistant(options: Readonly<{
  service: Omit<AssistantM1ServiceOptions, 'history' | 'proposals' | 'tools'>;
  database: Pick<AuthorityDatabase, 'authority' | 'withAuthorityReadSnapshot' | 'withAuthorityTransaction'>;
  starts: Pick<AssistantTypedProposalPorts, 'descriptors' | 'served' | 'plans' | 'runs' | 'rerunValues' | 'attachment' | 'ocrSources' | 'submit'>;
  readPlugins: () => readonly AssistantPlugin[];
  executeEditCommand?(command: LocalEditCommand): CommandResult;
}>) {
  const { database, service } = options, store = database.authority.assistantProposals;
  const browserMode = () => database.withAuthorityReadSnapshot(() => selectActiveRunSettings(database.authority)).config.browser.headless ? 'headless' as const : 'headed' as const;
  // Every assistant command reaches the kernel only with the attribution of the claim that owns it.
  const submit: AssistantTypedProposalPorts['submit'] = (command, attribution) => {
    if (!attributionOwnsCommand(store, command, attribution, service.owner().profileId)) throw new AssistantToolRefusal('ASSISTANT_PROPOSAL_REFUSED');
    return options.starts.submit(command, attribution);
  };
  const common = { ...options.starts, submit, current: service.owner, clock: service.clock, actorId: service.actorId, browserMode };
  const proposals = createAssistantTypedProposals({ ...common, store, plannedInputs: startPlanId => {
    const record = database.authority.startPlans.get(startPlanId);
    return record === undefined ? undefined : { capturedAt: record.plannedAt, runs: record.planned };
  } });
  const sessions = createAssistantSessionAuthorization({ ...common, claims: store.sessions,
    fullAccessAllowed: () => database.withAuthorityReadSnapshot(() => readSettings(database.authority).settings.preferences?.assistantFullAccess === true) });
  let activeEdit: LocalEditCommand | undefined;
  const applyEdit = createAssistantEditApply({ clock: service.clock, transaction: work => database.withAuthorityTransaction(work),
    record: input => database.authority.assistantAppliedEdits.insert(input),
    execute(command) {
      if (activeEdit !== undefined || options.executeEditCommand === undefined || command.source !== "assistant"
        || command.requestedBy !== service.actorId || !["apply-settings", "notification-read", "notification-unread"].includes(command.type)) {
        throw new AssistantAuthorizationError('assistant-effect-not-authorized');
      }
      activeEdit = command;
      try {
        const result = options.executeEditCommand(command);
        if (result.commandId !== command.commandId) throw new Error('assistant-edit-command-result-mismatch');
        return result;
      } finally { activeEdit = undefined; }
    },
  });
  const assistant = createAssistantM1Service({ ...service, proposals, atomic: work => database.withAuthorityTransaction(() => work()),
    history: () => { service.assertComposition?.(); return database.authority.assistantHistory; },
    tools: () => ({ plugins: [...options.readPlugins(), proposals.plugin, sessionsPlugin()], sessions,
      bindings: assistantValueBindings }) });
  return Object.freeze({ assistant, applyEdit,
    /** The command and worker effect hook: an assistant command runs only from its claimed proposal row or session claim. */
    assertEffect(commandId: string, command?: CommandRequest): void {
      proposals.assertEffect(commandId, command);
      sessions.assertEffect(commandId, command);
      if (command !== undefined && activeEdit?.commandId === commandId
        && canonicalJsonStringify(command) === canonicalJsonStringify(activeEdit)) return;
      if (command?.source.startsWith('assistant') === true && !store.hasRowCommand(commandId) && store.sessions.byCommand(commandId) === undefined) {
        throw new AssistantAuthorizationError('assistant-effect-not-authorized');
      }
    } });
}
