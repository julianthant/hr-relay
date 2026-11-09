import { CrossDateSearchQuerySchema } from '../../../../models/dashboard/search.js';
import { buildRunDetail, type RunDetailQueryDeps } from '../../../runs/queries/run-detail.js';
import type { CrossDateSearchQueryService } from '../../../runs/queries/search.js';
import { readSettings } from '../../../runtime/settings/settings-runtime.js';
import type { AuthorityDatabase } from '../../../storage/sqlite/authority-database.js';
import type { AssistantPluginDeps } from '../../../assistant/plugins/registry.js';
import type { AssistantWorkflowFacts } from '../../../assistant/plugins/workflows/facts.js';
import type { NotificationWire } from '../../../../models/dashboard/projection.js';
import type { WorkbookLibraryService } from '../../../workbooks/workbook-library-service.js';

export function createAssistantPluginDeps(options: Readonly<{
  database: Pick<AuthorityDatabase, 'authority' | 'withAuthorityReadSnapshot'>;
  runDetail: RunDetailQueryDeps;
  search: () => CrossDateSearchQueryService;
  notifications: () => { snapshot(actor: string): readonly NotificationWire[] };
  workbooks: () => Pick<WorkbookLibraryService, 'catalog' | 'read' | 'types'>;
  attachment: AssistantPluginDeps['attachment'];
  facts: () => AssistantWorkflowFacts;
  assertCurrent(): void;
}>): AssistantPluginDeps {
  const current = <T>(read: () => T): T => { options.assertCurrent(); const value = read(); options.assertCurrent(); return value; };
  return {
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
