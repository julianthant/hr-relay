import { expect } from '@playwright/test';
import { z } from 'zod';
import { test } from './helpers/fixtures.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { harness, disposeHttpRouteHarness } from '../support/helpers/backend/http-route-harness.js';
import { unexpectedWorkbookSync } from '../support/helpers/backend/workbook-sync.js';
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { FIXTURE_BOOTSTRAP } from './helpers/fixture-bootstrap.js';
import { assertMonotonicFrozen, installFrozenMonotonic } from './helpers/app-driver.js';
import { FIXTURE_DAY_WIRE } from './helpers/fixture-queue.js';
import { capturePresentationReference } from './helpers/presentation-reference.js';
import { attachShellA11y } from './helpers/shell-proof.js';
import { createStartPlanService, type StartPlanService } from '../../src/backend/runs/commands/start-plan-service.js';
import { createWorkbookLibraryService } from '../../src/backend/workbooks/workbook-library-service.js';
import { projectWorkflowStartSteps } from '../../src/backend/runs/queries/bootstrap.js';
import { descriptorSetHash } from '../../src/backend/app/registries/workflow-registry.js';
import { ReadWorkbookReference } from '../../src/models/processing/workbooks/read-reference.js';
import { defineCanonicalInput } from '../../src/models/workflow/canonical-input.js';
import { STANDARD_WORKFLOW_ACTIONS } from '../../src/models/workflow/presentation.js';
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema } from '../../src/models/dashboard/bootstrap.js';
import { projectWorkbookCompatibility } from '../../src/models/dashboard/workbook-library.js';
import { RunWorkbookNamedReferenceSchema } from '../../src/models/dashboard/workbooks.js';
import { StartPlanWireSchema, type StartPlanWire } from '../../src/models/dashboard/start-plan.js';
import { EidSchema } from '../../src/rules/identity/ids.js';
import { systemIdFactory } from '../../src/rules/identity/identifiers.js';
import { defineWorkflowDescriptor } from '../../src/workflow-kit/workflow.js';
import { flow } from '../../src/workflow-kit/flow.js';

const input = z.strictObject({ eid: EidSchema });
const typeId = 'reference-fixture-roster';
const descriptor = defineWorkflowDescriptor({ id: 'reference-fixture', code: 'rf', version: 1, contractFingerprint: 'f'.repeat(64),
  label: 'Reference fixture', icon: 'Search', category: 'operations', canonicalInput: defineCanonicalInput(input, input, [{ eid: '10800000' }]),
  inputSubject: 'eid', surface: { shape: 'single' }, enqueue: 'allow-parallel', actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: { inputRun: { placeholder: 'Enter employee IDs', parser: { split: { kind: 'delimited', delimiters: [';', '\n'] }, rules: [{ when: { kind: 'pattern', pattern: 'eid' }, emit: 'eid' }] } } },
  details: [], requiredWorkbookFields: ['eid', 'fullName'], workbookReference: { id: typeId, keyFieldId: 'eid', mode: 'keys', writableFields: [] }, referenceKeys: value => [value.eid],
  plannedOutputs: (_value, references) => [{ kind: 'workbook', name: 'Reference report.xlsx', rowSubject: 'person',
    rows: { state: 'known', count: references.flatMap(reference => reference.snapshot.rows.flatMap(row => row.matches)).length } }],
  identity: { matchKey: value => value.eid }, presentation: { title: value => value.eid }, scenarios: ['reference/preview'],
  flow: flow(input).step('read-reference', ReadWorkbookReference, { dependsOn: [], replay: 'checkpoint',
    bind: ({ input }) => ({ typeId, keys: [input.eid] }) })
    .build({ schema: ReadWorkbookReference.output, dependsOn: ['read-reference'], derive: ({ outputs }) => outputs['read-reference'] }),
});

for (const theme of ['light', 'dark']) for (const width of [1024, 1440]) {
  const evidence = `reference-plan-${theme}-${width}.a11y.yml`;
  test(`named reference planning ${theme} ${width}`, { annotation: [{ type: 'required-a11y-evidence', description: evidence }] }, async ({ page }, info) => {
    let planner: StartPlanService | undefined;
    const requirePlanner = () => { if (!planner) throw new Error('reference-planner-uninitialized'); return planner; };
    const h = await harness({ workbookWorkflows: [descriptor], startPlans: () => ({ plan: request => requirePlanner().plan(request), previewWarnings: request => requirePlanner().previewWarnings(request) }) });
    const hash = descriptorSetHash([...FIXTURE_BOOTSTRAP.workflows.map(workflow => WorkflowBootstrapPrimitiveSchema.parse(workflow).descriptorFingerprint), descriptor.contractFingerprint]);
    let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
    try {
      const repository = h.database.authority.workbooks;
      const library = createWorkbookLibraryService({ repository, clock: h.clock, sync: unexpectedWorkbookSync });
      const saved = library.create({ name: 'Applicants.xlsx', hasFormulas: false, themes: [], sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], headerRow: 1,
        columnBindings: ['eid', 'fullName'].map((fieldId, index) => ({ id: `col-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
        rows: [['eid', 'fullName'], ['10800000', 'Earlier person']].map((cells, index) => ({ id: `row-${index}`, cells: cells.map(value => ({ value })) })) }] });
      const current = library.read(saved.libraryId), changed = structuredClone(current.workbook);
      changed.sheets[0].rows[1].cells[1].value = 'Current person'; library.save(saved.libraryId, current.version, changed);
      const state = repository.libraryState(saved.libraryId);
      await library.libraryAction(saved.libraryId, { operationId: 'fall-hires', expectedVersion: library.read(saved.libraryId).version, expectedRevision: state.revision,
        change: { kind: 'create-version', name: 'Fall hires', from: { kind: 'version', versionId: 'original' }, useNow: false } }, new AbortController().signal);
      const version = repository.libraryState(saved.libraryId).versions.find(version => version.name === 'Fall hires'); expect(version).toBeDefined();
      const compatibility = projectWorkbookCompatibility([descriptor], [{ libraryId: saved.libraryId,
        versionId: repository.libraryState(saved.libraryId).selectedVersionId, origin: { kind: 'local' }, removed: false,
        sheets: library.libraryVersion(saved.libraryId).workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name,
          mappings: (sheet.columnBindings ?? []).map((binding, column) => ({ fieldId: binding.fieldId!, column, basis: 'manual' as const })) })) }]);
      const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_BOOTSTRAP, descriptorHash: hash, workbookCompatibility: compatibility,
        workflows: [...FIXTURE_BOOTSTRAP.workflows,
          { id: descriptor.id, code: descriptor.code, label: descriptor.label, categoryId: descriptor.category, descriptorFingerprint: descriptor.contractFingerprint,
            availability: { state: 'available' }, role: { kind: 'standalone' }, start: { readiness: { scope: 'workbook-sources', state: 'selection-needed',
              fixAction: { kind: 'choose-workbook-sources', workflowId: descriptor.id } }, enqueue: descriptor.enqueue, version: descriptor.version,
              steps: projectWorkflowStartSteps(descriptor), inputRun: descriptor.surfaces.inputRun, spreadsheetIntake: false,
              requiredWorkbookFields: [...descriptor.requiredWorkbookFields], workbookReference: descriptor.workbookReference } }] });
      server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' },
        profile: { bootstrap, descriptorHash: hash, day: { ...FIXTURE_DAY_WIRE, descriptorHash: hash } } });
      const config = h.database.authority.runtimeConfig.get(); if (!config) throw new Error('reference-config-missing');
      planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: systemIdFactory,
        descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined }, workbooks: library, planTtlMs: 600_000,
        configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: 'local-operator' });
      const requests: unknown[] = [];
      let planned: StartPlanWire | undefined;
      await page.route(/\/api\/v1\/(?:workbooks|start-plans)(?:\/|$)/u, async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (request.method() === 'POST') requests.push(request.postDataJSON());
        const response = await h.app.request(`http://localhost${path}`, { method: request.method(), headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' },
          ...(request.postData() ? { body: request.postData()! } : {}) });
        const body = await response.text();
        if (path === '/api/v1/start-plans' && response.ok) planned = StartPlanWireSchema.parse(JSON.parse(body));
        await route.fulfill({ status: response.status, contentType: 'application/json', body });
      });
      await page.addInitScript(value => Reflect.set(window, 'relayParityTheme', value), theme);
      // The queue behind the dialog shows live elapsed times from the monotonic clock; freeze it so captures do not depend on test speed.
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width, height: 1000 }); await page.goto(`${server.baseUrl}/?fixture=hub-integration`);
      await page.getByRole('button', { name: 'Start a run', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Start a run', exact: true });
      await dialog.getByRole('navigation', { name: 'Workflow', exact: true }).getByRole('button', { name: /Reference fixture/u }).click();
      await dialog.getByRole('textbox', { name: 'Employee IDs', exact: true }).fill('10800000');
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      const reference = dialog.getByRole('button', { name: 'Reference spreadsheet', exact: true });
      await expect(reference).toBeVisible(); expect((await reference.boundingBox())!.height).toBe(36);
      await reference.click();
      await page.getByRole('menuitemradio', { name: 'Applicants.xlsx', exact: true }).click();
      await dialog.getByRole('button', { name: /Reference version/u }).click();
      await page.getByRole('menuitemradio', { name: 'Fall hires', exact: true }).click();
      await dialog.getByRole('button', { name: 'Reference worksheet', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'People', exact: true }).click();
      await expect(dialog.locator(':scope > header')).toBeInViewport({ ratio: 1 });
      expect(await dialog.evaluate(node => node.scrollTop)).toBe(0);
      await assertMonotonicFrozen(page);
      await capturePresentationReference(page, info, 'options', hash);
      await dialog.getByRole('button', { name: 'Preview plan', exact: true }).click();
      await expect(dialog.getByRole('heading', { name: 'Plan', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole('group', { name: 'Run plan', exact: true })).toContainText('Applicants.xlsx · Fall hires');
      await expect(dialog.getByRole('group', { name: 'Run outputs', exact: true })).toContainText('Reference report.xlsx');
      await expect(dialog.getByRole('group', { name: 'Run outputs', exact: true })).toContainText('1 person');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ workbookReferences: [{ entry: 1, libraryId: saved.libraryId, versionId: version!.id, sheetId: 'people', expectedVersion: 2 }] });
      const request = requests[0] as { workbookReferences: object[] };
      expect(Object.keys(request.workbookReferences[0]).sort()).toEqual(['entry', 'expectedVersion', 'libraryId', 'sheetId', 'versionId']);
      if (!planned) throw new Error('reference-plan-not-retained');
      const retained = h.database.authority.startPlans.get(planned.startPlanId); if (!retained) throw new Error('reference-plan-missing');
      const bound = RunWorkbookNamedReferenceSchema.parse(retained.planned[0].workbookReferences?.[0].value);
      expect(bound.snapshot.versionId).toBe(version!.id);
      expect(bound.snapshot.rows[0].matches[0].values.fullName).toBe('Earlier person');
      await capturePresentationReference(page, info, 'confirm', hash);
      await dialog.getByRole('group', { name: 'Run outputs', exact: true }).scrollIntoViewIfNeeded();
      await expect(dialog.locator(':scope > header')).toBeInViewport({ ratio: 1 });
      await capturePresentationReference(page, info, 'confirm-output', hash); await attachShellA11y(page, info, evidence);
    } finally { await server?.close(); await disposeHttpRouteHarness(); }
  });
}
