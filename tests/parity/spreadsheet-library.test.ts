import { expect } from '@playwright/test';
import { test } from './helpers/fixtures.js';
import { harness, disposeHttpRouteHarness } from '../support/helpers/backend/http-route-harness.js';
import { capturePresentationReference } from './helpers/presentation-reference.js';
import { attachShellA11y } from './helpers/shell-proof.js';
import { SavedWorkbookWireSchema } from '../../src/models/dashboard/workbooks.js';

for (const theme of ['light', 'dark']) for (const width of [1024, 1440]) {
  test(`named library actions ${theme} ${width}`, { annotation: [{ type: 'required-a11y-evidence', description: `named-library-${theme}-${width}.a11y.yml` }] }, async ({ page, hubServer }, info) => {
    const h = await harness(), posts: string[] = [];
    const headers = { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' };
    const post = (path: string, body: unknown) => h.app.request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    try {
      const created = await post('/api/v1/workbooks', { workbook: { name: 'Student applicants.xlsx', hasFormulas: false, themes: [], sheets: [{ id: 'people', name: 'July 6', width: 2, hidden: [], headerRow: 1,
        columnBindings: ['email', 'fullName'].map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: 'manual' })),
        rows: [['email', 'fullName'], ['example@example.edu', 'Example, Person']].map((cells, index) => ({ id: `row-${index}`, cells: cells.map(value => ({ value })) })) }] } });
      expect(created.status).toBe(201);
      const record = SavedWorkbookWireSchema.parse(await created.json());
      let hideStatus = true;
      await page.route('**/api/v1/workbooks**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const response = await h.app.request(`http://localhost${path}`, { method: request.method(), headers, ...(request.postData() ? { body: request.postData()! } : {}) });
        if (request.method() === 'POST') { posts.push(path); await route.abort(); return; }
        if (hideStatus && path.includes('/library-actions/')) { await route.fulfill({ json: { state: 'absent' } }); return; }
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      });
      await page.addInitScript(value => Reflect.set(window, 'relayParityTheme', value), theme);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${hubServer.baseUrl}/?fixture=hub-integration&settings=spreadsheets`);
      const library = page.getByRole('table', { name: 'Your spreadsheets', exact: true });
      await expect(library.getByRole('button', { name: 'Open Student applicants.xlsx', exact: true })).toBeVisible();
      await capturePresentationReference(page, info, 'library');
      const versions = page.getByRole('button', { name: 'Versions of Student applicants.xlsx', exact: true });
      await versions.click();
      const drawer = page.getByRole('dialog', { name: 'Versions', exact: true });
      await expect(drawer.getByText('Original version', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'New version', exact: true }).click();
      const create = page.getByRole('dialog', { name: 'New version', exact: true });
      await create.getByRole('textbox', { name: 'Version name', exact: true }).fill('Fall hires added');
      await capturePresentationReference(page, info, 'new-version');
      await create.getByRole('button', { name: 'Create version', exact: true }).click();
      await expect(create.getByText(/not yet confirmed/)).toBeVisible();
      await expect(create.getByRole('button', { name: 'Create version', exact: true })).toBeDisabled();
      expect(posts).toEqual([`/api/v1/workbooks/${record.libraryId}/library-actions`]);
      await create.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(drawer.getByRole('button', { name: 'Check result', exact: true })).toBeEnabled();
      await capturePresentationReference(page, info, 'uncertain');
      hideStatus = false;
      await drawer.getByRole('button', { name: 'Check result', exact: true }).click();
      await expect(drawer.getByText('Fall hires added', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Check result', exact: true })).toHaveCount(0);
      expect(posts).toHaveLength(1);
      await capturePresentationReference(page, info, 'versions');
      await drawer.getByRole('button', { name: 'Close', exact: true }).click(); await expect(versions).toBeFocused();
      await attachShellA11y(page, info, `named-library-${theme}-${width}.a11y.yml`);
    } finally { await disposeHttpRouteHarness(); }
  });
}
