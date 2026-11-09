import { CrossDateSearchQuerySchema, SearchCoverageSchema } from '../../../../models/dashboard/search.js';
import { buildRunDetail, type RunDetailQueryDeps } from '../../../runs/queries/run-detail.js';
import type { CrossDateSearchQueryService } from '../../../runs/queries/search.js';
import { readSettings } from '../../../runtime/settings/settings-runtime.js';
import type { AuthorityDatabase } from '../../../storage/sqlite/authority-database.js';
import type { AssistantPluginDeps } from '../../../assistant/plugins/registry.js';
import type { AssistantWorkflowFacts } from '../../../assistant/plugins/workflows/facts.js';
import type { NotificationWire } from '../../../../models/dashboard/projection.js';
import type { WorkbookLibraryService } from '../../../workbooks/workbook-library-service.js';
import type { RunRecordService } from '../../../runs/lifecycle/run-record-service.js';
import type { RunRecord } from '../../../../models/run/record.js';
import { PersonLookupCanonicalInput } from '../../../../models/workflows/person-lookup/input.js';
import { parseCanonicalInputSnapshot } from '../../../../models/workflow/canonical-input.js';
import { searchPartitionDay } from '../../../../models/dashboard/search-calendar.js';
import { EidSchema } from '../../../../rules/identity/ids.js';
import { AssistantToolRefusal } from '../../../assistant/plugins/plugin.js';
import { hasProtectedSubject, protectedSubjectDisplay } from '../../../runs/start/protected-input.js';

function lookupEid(row: RunRecord): string | undefined {
  if (row.envelope.workflow !== 'person-lookup' || (row.envelope.shape !== 'single' && row.envelope.shape !== 'operation-member')
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
  facts: () => AssistantWorkflowFacts;
  assertCurrent(): void;
}>): AssistantPluginDeps {
  const current = <T>(read: () => T): T => { options.assertCurrent(); const value = read(); options.assertCurrent(); return value; };
  const label = (row: RunRecord) => protectedSubjectDisplay(row.input.parsed.protectedBindings, () => {
    const eid = lookupEid(row), workflow = options.facts().facts.find(fact => fact.id === row.envelope.workflow)?.label ?? row.envelope.workflow;
    return { title: `${workflow}${row.runNumber === undefined ? '' : ` #${String(row.runNumber)}`}${eid === undefined ? '' : ` · EID ${eid}`} · ${row.envelope.enqueuedAt} · attempt ${String(row.envelope.attempt)}` };
  }).title;
  return {
    findLookupRuns: eid => current(() => options.database.withAuthorityReadSnapshot(() => {
      const exact = EidSchema.parse(eid), matches: RunRecord[] = [];
      let cursor: Parameters<RunRecordService['list']>[0]['cursor'];
      let scanned = 0;
      do {
        const page = options.runs.list({ workflow: 'person-lookup', disposition: 'live', limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
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
