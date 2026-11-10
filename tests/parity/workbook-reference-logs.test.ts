import { expect, test } from '@playwright/test';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { pickedRunWorld } from '../support/helpers/dashboard/picked-dashboard.js';
import { workbookReferenceLogs } from '../support/fixtures/workbook-reference-choice.js';
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from '../../src/models/dashboard/projection.js';
import { CommandRequestSchema } from '../../src/rules/commands/commands.js';
import { WorkflowBootstrapPrimitiveSchema } from '../../src/models/dashboard/bootstrap.js';
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { installFrozenMonotonic } from './helpers/app-driver.js';
import { capturePresentationReference } from './helpers/presentation-reference.js';
import { attachShellA11y } from './helpers/shell-proof.js';

for (const theme of ['light', 'dark'] as const) for (const width of [1024, 1440]) {
  const evidence = `workbook-reference-logs-${theme}-${width}.a11y.yml`;
  test(`ordered roster reference Logs ${theme} ${width}`, { annotation: [{ type: 'required-a11y-evidence', description: evidence }] }, async ({ page }, info) => {
    const base = pickedRunWorld('running');
    const descriptor = base.bootstrap.workflows.map(workflow => WorkflowBootstrapPrimitiveSchema.parse(workflow)).find(workflow => workflow.id === 'onboarding');
    if (!descriptor) throw new Error('onboarding fixture descriptor missing');
    const errors: string[] = [], writes: unknown[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installFrozenMonotonic(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => { Reflect.set(window, 'relayParityTheme', value); Reflect.set(window, 'relayParityMotion', false); }, theme);
    for (const state of ['unavailable', 'resolved', 'available'] as const) {
      const f = workbookReferenceLogs(state);
      const row = QueueSurfaceWireSchema.parse({ ...base.row, runId: f.detail.runId, traceId: f.detail.header.traceId,
        attempt: f.detail.header.attempt, workflowId: descriptor.id, descriptorHash: descriptor.descriptorFingerprint,
        rowRevision: f.detail.rowRevision, title: f.detail.header.title, status: f.detail.header.status,
        liveMessage: { state: 'present', value: state === 'available' ? 'Waiting for a roster row' : state === 'resolved' ? 'Roster row retained' : 'Roster lookup pending' },
        gateOpenedAt: f.detail.gate.state === 'open' ? { state: 'present', value: f.detail.gate.openedAt } : { state: 'absent', reason: 'No open gate' },
        actions: [], pauseControl: { state: 'unavailable', expectedVersion: f.detail.rowRevision },
        pipeline: f.detail.timeline.steps!.map(step => ({ id: step.key, label: step.label, state: step.state })) });
      const statusCounts = [{ status: row.status, count: 1 }];
      const day = DashboardDayWireSchema.parse({ ...base.day, queueSurfaces: [row], statusCounts,
        attemptHistory: [{ runId: row.runId, startedAt: row.startedAt, endedAt: row.endedAt }],
        workflowCounts: [{ workflowId: row.workflowId, count: 1, statusCounts }] });
      const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' }, dayWire: day,
        profile: { bootstrap: base.bootstrap, day, descriptorHash: day.descriptorHash } });
      let release: (() => void) | undefined;
      try {
        await page.route('**/api/v1/application-lifecycle', route => route.fulfill({ json: { ...base.lifecycle, targets: [] } }));
        await page.route(`**/api/v1/runs/${row.runId}`, route => route.fulfill({ json: f.detail }));
        await page.route(`**/api/v1/runs/${row.runId}/logs`, route => route.fulfill({ json: f.logs }));
        await page.route(`**/api/v1/runs/${row.runId}/workbook-writes`, route => route.fulfill({ json: f.workbooks }));
        await page.route('**/api/v1/commands', async route => {
          writes.push(CommandRequestSchema.parse(route.request().postDataJSON()));
          await new Promise<void>(resolve => { release = resolve; });
          await route.fulfill({ status: 503, json: { state: 'error', code: 'COMMAND_OUTCOME_UNCERTAIN', message: 'Synthetic lost response', retryable: false } });
        });
        await page.goto(`${server.baseUrl}/?fixture=picked-a&day=${day.day}&run=${row.runId}&view=${encodeURIComponent(JSON.stringify({ workflow: row.workflowId, preview: null }))}`);
        const logs = page.getByRole('region', { name: 'Run logs', exact: true });
        await expect(logs).toBeVisible();
        const decision = logs.locator('[data-decision-state]');
        await expect(decision).toHaveCount(1);
        await expect(page.getByText('Write parked', { exact: true })).toHaveCount(0);
        await expect(decision).toHaveAttribute('data-decision-state', state === 'available' ? 'review' : state === 'resolved' ? 'recorded' : 'failed');
        await expect(logs.locator('section > div > header > h3')).toHaveText(state === 'unavailable'
          ? ['Look up in roster', 'Read reference', 'Run notes'] : ['Read reference', 'Look up in roster', 'Run notes']);
        if (state === 'unavailable') await expect(decision.locator('xpath=ancestor::section').locator(':scope > time')).toHaveText('—');
        if (state !== 'available') await expect(decision.getByRole('button')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await capturePresentationReference(page, info, state, day.descriptorHash);
        if (state === 'available') {
          const next = decision.getByRole('button', { name: 'Confirm', exact: true });
          const radios = decision.getByRole('radio');
          await expect(next).toBeDisabled(); await expect(radios).toHaveCount(2);
          await radios.nth(1).click();
          await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true'); await expect(next).toBeEnabled();
          await capturePresentationReference(page, info, 'selected', day.descriptorHash);
          await next.click();
          await expect(next).toBeDisabled(); await expect(radios.first()).toBeDisabled();
          await expect(page.getByText('Pending', { exact: true })).toBeVisible();
          await capturePresentationReference(page, info, 'pending', day.descriptorHash);
          expect(writes).toHaveLength(1);
          expect(writes[0]).toMatchObject({ type: 'resolve-workbook-reference-row', target: f.target,
            payload: { sheetId: f.candidates[1].sheetId, rowId: f.candidates[1].rowId } });
          release!();
          await expect(page.getByRole('button', { name: 'Replay exact decision', exact: true })).toBeEnabled();
          await expect(next).toBeDisabled(); await expect(radios.nth(1)).toBeDisabled();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          // The shell paints recovery on its next render after publish; capture that settled state.
          const recovery = page.getByRole('region', { name: 'Commands awaiting recovery' });
          await expect(recovery).toBeVisible();
          await expect(recovery.getByRole('button', { name: 'Review resolve-workbook-reference-row (1 run)', exact: true })).toBeVisible();
          await capturePresentationReference(page, info, 'uncertain', day.descriptorHash);
          expect(writes).toHaveLength(1);
        }
        expect(errors).toEqual([]);
        if (state === 'available') await attachShellA11y(page, info, evidence);
      } finally { release?.(); await page.unrouteAll({ behavior: 'wait' }); await server.close(); }
    }
  });
}
