import type { Page, Route } from '@playwright/test';
import { startFixtureServer } from './fixture-bff.js';
import { MOCK_DIST_DIR } from '../../../mocks/helpers/bundle.js';
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PLAN } from '../../../mocks/helpers/fixture-start.js';
import { uuidOf, traceOf, FIXTURE_DAY } from '../../../mocks/helpers/fixture-identity.js';
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema } from '../../../../src/models/dashboard/bootstrap.js';
import { WorkbookLibraryCatalogSchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from '../../../../src/models/dashboard/workbook-library.js';
import { WorkbookTypeSchema } from '../../../../src/models/dashboard/workbooks.js';
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from '../../../../src/models/dashboard/start-plan.js';
import { DashboardStreamEnvelopeSchema } from '../../../../src/models/dashboard/subscription.js';
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from '../../../../src/models/dashboard/projection.js';
import { ItemAttemptHistoryResponseSchema } from '../../../../src/models/dashboard/item-attempt-history.js';
import { CommandResultSchema, StartCommandRequestSchema } from '../../../../src/rules/commands/commands.js';
import { deriveItemId } from '../../../../src/rules/identity/logical-item.js';
import { OnboardingInput } from '../../../../src/models/workflows/onboarding/input.js';
import { ONBOARDING_ROSTER_FIELDS } from '../../../../src/models/workflows/onboarding/roster.js';

export const ROW_EMAILS = ['alpha@example.test', 'alpha@example.test', 'bravo@example.test'] as const;
export const ROW_IDS = ['alpha', 'alpha-duplicate', 'bravo'] as const;
const libraryId = 'mock-onboarding-roster';
const type = WorkbookTypeSchema.parse({ id: 'onboarding-roster', name: 'Onboarding roster', keyFieldId: 'email', fields: ONBOARDING_ROSTER_FIELDS, defaultWorkbookId: libraryId });
const versions = ['Reviewed roster', 'Delayed roster', 'New roster', 'Empty roster', 'Unavailable roster'].map((name, index) => ({
  id: `roster-${index + 1}`, name, version: index + 1, snapshotId: `snapshot-${index + 1}`, savedAt: '2026-08-03T09:00:00-07:00', source: 'operator',
}));
const catalog = WorkbookLibraryCatalogSchema.parse([{ libraryId, version: 5, name: 'Onboarding.xlsx', updatedAt: versions[0].savedAt, rowCount: 4,
  worksheets: [{ id: 'people', name: 'People' }], metadata: { typeId: type.id, sharePoint: null }, type,
  state: { libraryId, revision: 1, selectedVersionId: versions[0].id, origin: { kind: 'local' }, removed: false, versions },
}]);
const workflow = (() => {
  const value = FIXTURE_START_PICKER_BOOTSTRAP.workflows.map(entry => WorkflowBootstrapPrimitiveSchema.parse(entry)).find(entry => entry.id === 'onboarding');
  if (value?.start.inputRun?.workbookRows === undefined) throw new Error('onboarding-row-capability-missing');
  return value;
})();
const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: [workflow] });

function versionView(id: string) {
  const version = versions.find(value => value.id === id);
  if (version === undefined) throw new Error(`unknown fixture version ${id}`);
  const cells = (email: string, firstName: string, lastName: string) => ONBOARDING_ROSTER_FIELDS.map(field => ({
    value: field === 'email' ? email : field === 'fullName' ? `${firstName} ${lastName}` : null,
  }));
  const data = id === 'roster-4' ? [] : [...ROW_EMAILS.map((email, index) => ({ id: ROW_IDS[index], cells: cells(email, 'Person', `Example ${index + 1}`) })),
    { id: 'blank', cells: cells('', 'Missing', 'Key') }];
  return WorkbookLibraryVersionViewSchema.parse({ libraryId, version, workbook: { libraryId, name: 'Onboarding.xlsx', hasFormulas: false, themes: [],
    sheets: [{ id: 'people', name: id === 'roster-3' ? 'New people' : 'People', width: ONBOARDING_ROSTER_FIELDS.length, hidden: [], headerRow: 1,
      columnBindings: ONBOARDING_ROSTER_FIELDS.map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
      rows: [{ id: 'header', cells: ONBOARDING_ROSTER_FIELDS.map(value => ({ value })) }, ...data] }] } });
}

/** Synthetic HTTP authority for rendered launcher checks; never opens an authority store. */
async function startWorkbookRowsFixture(page: Page) {
  const profile = { bootstrap, descriptorHash: bootstrap.descriptorHash, day: DashboardDayWireSchema.parse({ ...FIXTURE_START_PICKER_DAY_WIRE, queueSurfaces: [], attemptHistory: [], monthCounts: [{ day: FIXTURE_DAY, count: 0 }], workflowCounts: [], statusCounts: [], workerCards: [], workerPools: [], workerAuthority: { state: 'present', members: [] }, notifications: [] }) };
  const server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: 'working-tree' }, profile });
  const plans: StartPlanRequest[] = [], commands: ReturnType<typeof StartCommandRequestSchema.parse>[] = [], commandBodies: string[] = [];
  const currentCatalog = structuredClone(catalog); let rows: ReturnType<typeof QueueSurfaceWireSchema.parse>[] = [];
  const compatibility = () => projectWorkbookCompatibility([{ id: workflow.id, label: workflow.label,
    requiredWorkbookFields: workflow.start.requiredWorkbookFields, workbookReference: workflow.start.workbookReference }],
    currentCatalog.map(entry => ({ libraryId: entry.libraryId, versionId: entry.state.selectedVersionId,
      origin: entry.state.origin, removed: entry.state.removed,
      sheets: versionView(entry.state.selectedVersionId).workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name,
        mappings: sheet.columnBindings?.flatMap((binding, column) => binding.fieldId !== null && binding.basis !== 'unmapped'
          ? [{ fieldId: binding.fieldId, column, basis: binding.basis }] : []) ?? [] })) })));
  let plan: ReturnType<typeof StartPlanWireSchema.parse> | undefined;
  let loseResponse = false, delayedVersion = false;
  let releaseVersion: (() => void) | undefined;
  const pendingVersions: string[] = [];
  const day = () => DashboardDayWireSchema.parse({ ...profile.day, snapshotCursor: rows.length === 0 ? 'pc:1' : `pc:${commands.length + 1}`, queueSurfaces: rows,
    attemptHistory: rows.map(({ runId, startedAt, endedAt }) => ({ runId, startedAt, endedAt })),
    monthCounts: [{ day: FIXTURE_DAY, count: rows.length }],
    workflowCounts: rows.length === 0 ? [] : [{ workflowId: workflow.id, count: rows.length, statusCounts: [{ status: 'queued', count: rows.length }] }],
    statusCounts: rows.length === 0 ? [] : [{ status: 'queued', count: rows.length }],
  });
  const json = (route: Route, value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  const handler = async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/v1/workbooks/catalog') {
      return json(route, WorkbookLibraryCatalogSchema.parse(currentCatalog));
    }
    if (path === '/api/v1/workbooks/compatibility') return json(route, compatibility());
    if (path === '/api/v1/workbooks/types') return json(route, [type]);
    if (path === '/api/v1/workbooks/list') return json(route, []);
    if (path.startsWith(`/api/v1/workbooks/${libraryId}/versions/`)) {
      const id = decodeURIComponent(path.split('/').at(-1)!);
      if (id === 'roster-5') return route.abort('failed');
      if (id === 'roster-2' && delayedVersion) {
        delayedVersion = false; pendingVersions.push(id);
        await new Promise<void>(resolve => { releaseVersion = resolve; });
      }
      return json(route, versionView(id));
    }
    if (path === '/api/v1/start-plans') {
      const input = StartPlanRequestSchema.parse(request.postDataJSON()); plans.push(structuredClone(input));
      plan = StartPlanWireSchema.parse({ ...FIXTURE_START_PLAN, workflowId: workflow.id, startPlanId: uuidOf(9600),
        browserMode: input.browserMode, captureBrowserScreenshots: input.captureBrowserScreenshots, dryRun: input.dryRun, priority: input.priority ?? 'interactive',
        fingerprints: { ...FIXTURE_START_PLAN.fingerprints, descriptorFingerprint: workflow.descriptorFingerprint },
        planned: [1, 3].map(entry => {
          const selection = input.workbookReferences?.find(reference => reference.entry === entry);
          if (selection?.versionId === undefined) throw new Error('fixture-reference-missing');
          const submission = OnboardingInput.parse(input.submissions[entry - 1]), selected = versionView(selection.versionId);
          const matchKey = submission.email.toLowerCase();
          return { logicalKey: deriveItemId(workflow.id, matchKey), title: submission.email, matchKey, subtitle: 'Read-only review · hire unavailable',
            workbookReferences: [{ libraryId, version: currentCatalog[0].version, versionId: selected.version.id, versionName: selected.version.name, selectedRow: selection.selectedRow,
              worksheets: selected.workbook.sheets.map(sheet => ({ sheetId: sheet.id, name: sheet.name })), type }] };
        }), refused: [{ entry: 2, code: 'active-run-exists', message: 'This selected row repeats the normalized email from entry 1.' }] });
      return json(route, plan);
    }
    if (path === '/api/v1/commands') {
      const command = StartCommandRequestSchema.parse(request.postDataJSON()); commands.push(command); commandBodies.push(request.postData()!);
      if (plan === undefined) throw new Error('fixture-command-without-plan');
      if (rows.length === 0) {
        const seed = FIXTURE_START_PICKER_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === 'single' && row.status === 'queued');
        if (seed === undefined) throw new Error('fixture-queue-seed-missing');
        rows = plan.planned.map((entry, index) => QueueSurfaceWireSchema.parse({ ...seed, runId: uuidOf(9700 + index), itemId: entry.logicalKey,
          traceId: traceOf(9700 + index), runNumber: { state: 'present', value: index + 1 }, workflowId: workflow.id, descriptorVersion: workflow.start.version, descriptorHash: command.payload.descriptorFingerprint,
          configFingerprint: command.payload.configFingerprint, actorId: command.requestedBy, title: entry.title, dryRun: plan!.dryRun,
          subtitle: { state: 'present', value: entry.subtitle }, pipeline: workflow.start.steps.map(step => ({ id: step.key, label: step.label, state: 'pending' })),
          rowRevision: 1,
          session: { state: 'present', itemScope: workflow.id === 'person-lookup' ? 'session' : 'workflow', sessionId: uuidOf(9900), presentation: { layout: 'items', groupInQueue: false, version: 1, startedAt: seed.startedAt },
            origin: { kind: 'start-plan', startPlanId: command.target.startPlanId, actorId: command.requestedBy } } }));
      }
      server.publish(DashboardStreamEnvelopeSchema.parse({ type: 'snapshot', topic: 'dashboard-day', cursor: `pc:${commands.length + 1}`, payload: day() }));
      if (loseResponse) { loseResponse = false; return route.fulfill({ status: 200, contentType: 'application/json', body: '' }); }
      return json(route, CommandResultSchema.parse({ state: commands.length === 1 ? 'applied' : 'already-applied', commandId: command.commandId,
        affectedTargets: [{ family: 'start', ...command.target }, ...rows.map(row => ({ family: 'run', runId: row.runId }))] }));
    }
    if (path === '/api/v1/dashboard') return json(route, day());
    const history = /^\/api\/v1\/runs\/([^/]+)\/attempt-history$/u.exec(path);
    if (history !== null) {
      const row = rows.find(value => value.runId === history[1]); if (row === undefined) throw new Error('fixture-history-run-missing');
      const identity = { runId: row.runId, workflowId: row.workflowId, itemId: row.itemId, attempt: row.attempt, rowRevision: row.rowRevision };
      return json(route, ItemAttemptHistoryResponseSchema.parse({ schemaVersion: 1, state: 'available', selected: { state: 'present', disposition: 'live', ...identity },
        item: { workflowId: row.workflowId, itemId: row.itemId }, page: { limit: 50, offset: 0, totalEntries: 1, nextCursor: null,
          entries: [{ disposition: 'live', ...identity, partitionDay: FIXTURE_DAY }] } }));
    }
    return route.fallback();
  };
  await page.route('**/api/v1/**', handler);
  return { server, plans, commands, commandBodies, pendingVersions, workflow, libraryId, type, day,
    get plan() { return plan; }, get rows() { return rows; },
    delayVersion() { delayedVersion = true; }, releaseVersion() { if (!releaseVersion) throw new Error('no-delayed-version'); releaseVersion(); },
    loseResponse() { loseResponse = true; },
    async close() {
      releaseVersion?.();
      const settlements = await Promise.allSettled([page.unroute('**/api/v1/**', handler), server.close()]);
      const errors = settlements.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'workbook-rows-fixture-cleanup-failed');
    },
  };
}
export type WorkbookRowsFixture = Awaited<ReturnType<typeof startWorkbookRowsFixture>>;

export async function withWorkbookRowsFixture(page: Page, body: (fixture: WorkbookRowsFixture) => Promise<void>) {
  const fixture = await startWorkbookRowsFixture(page);
  let primary: { error: unknown } | undefined;
  try { await body(fixture); } catch (error) { primary = { error }; }
  try { await fixture.close(); } catch (error) {
    if (primary !== undefined) throw new AggregateError([primary.error, error], 'workbook-rows-body-and-cleanup-failed', { cause: error });
    throw error;
  }
  if (primary !== undefined) throw primary.error;
}
