import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-queue.js";
import { queueDisplayGroups, visibleRunIds } from "../../../src/dashboard/surfaces/queue-model.js";
import { SettingsSectionPrimitiveSchema } from "../../../src/domain/dashboard/bootstrap.js";
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import Excel from 'exceljs';
import { DEFAULT_SHORTCUT_PREFERENCES, shortcutActionForEvent, shortcutChord, validateShortcutPreferences } from '../../../src/dashboard/surfaces/keyboard-preferences-model.js';
import { estimatedSavedMinutes } from '../../../src/dashboard/surfaces/activity/activity-effort-model.js';
import { toggleQueueFilter } from '../../../src/dashboard/surfaces/queue-filter-model.js';
import { cellText, editSpreadsheetCell, importSpreadsheet, newEditableWorkbook, sortSpreadsheet, spreadsheetColor, spreadsheetCsv, spreadsheetXlsx } from '../../../src/dashboard/surfaces/spreadsheet-editor-model.js';
import { buildSettingsNav, resolveSettingsSection } from '../../../src/dashboard/surfaces/settings-model.js';
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID } from '../../../src/domain/dashboard/settings.js';

function bytes(value: Uint8Array): ArrayBuffer { return value.slice().buffer; }

describe('HR GPT presentation models', () => {
  it('combines quick filters and returns to All after removing the last one', () => {
    assert.deepEqual(toggleQueueFilter(['all'], 'needsYou'), ['needsYou']);
    assert.deepEqual(toggleQueueFilter(['needsYou'], 'running'), ['needsYou', 'running']);
    assert.deepEqual(toggleQueueFilter(['needsYou', 'running'], 'needsYou'), ['running']);
    assert.deepEqual(toggleQueueFilter(['running'], 'running'), ['all']);
    assert.deepEqual(toggleQueueFilter(['failed', 'running'], 'all'), ['all']);
  });
  it('estimates only from explicit manual and assisted baselines', () => {
    assert.equal(estimatedSavedMinutes(14, { manual: '12', assisted: '2' }), 140);
    assert.equal(estimatedSavedMinutes(0, { manual: '12', assisted: '2' }), 0);
    for (const baseline of [{ manual: '', assisted: '2' }, { manual: '12', assisted: '' }, { manual: '1', assisted: '2' }, { manual: '-1', assisted: '0' }, { manual: 'NaN', assisted: '0' }]) assert.equal(estimatedSavedMinutes(14, baseline), null);
  });
  it('groups only Attention mode and shares flat sorting with keyboard navigation', () => {
    const rows = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.surfaceKind !== 'member');
    assert.equal(queueDisplayGroups(rows, 'attention', '2026-08-03T18:00:00Z').length, 4);
    for (const sort of ['newest', 'oldest', 'longest'] as const) {
      const groups = queueDisplayGroups(rows, sort, '2026-08-03T18:00:00Z');
      assert.equal(groups.length, 1); assert.equal(groups[0].key, null);
      const ordered = groups[0].rows;
      const durations = ordered.map(row => Date.parse(row.endedAt.state === 'present' ? row.endedAt.value : '2026-08-03T18:00:00Z') - Date.parse(row.startedAt));
      if (sort === 'longest') assert.deepEqual(durations, [...durations].sort((a,b) => b-a));
      else { const dates = ordered.map(row => Date.parse(row.startedAt)); assert.deepEqual(dates, [...dates].sort((a,b) => sort === 'oldest' ? a-b : b-a)); }
      assert.deepEqual(visibleRunIds(rows, sort, '2026-08-03T18:00:00Z'), ordered.map(row => String(row.runId)));
    }
  });
  it('moves Spreadsheets into Data and resolves old capability links to Preflight', () => {
    const groups = buildSettingsNav([SettingsSectionPrimitiveSchema.parse({ id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: 'Workflow capabilities', revision: 1 })]);
    assert(!groups.find(group => group.id === 'personal')?.entries.some(entry => entry.id === 'spreadsheets'));
    assert(groups.find(group => group.id === 'data')?.entries.some(entry => entry.id === 'spreadsheets'));
    assert(!groups.flatMap(group => group.entries).some(entry => entry.id === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID));
    const resolved = resolveSettingsSection(groups, SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID);
    assert.equal(resolved.state, 'open'); if (resolved.state === 'open') assert.equal(resolved.entry.id, 'preflight');
  });
  it('uses customized bindings and rejects collisions and reserved number shortcuts', () => {
    const preferences = validateShortcutPreferences({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, start: ['Meta+Shift+r'] } });
    const event = { key: 'R', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    assert.equal(shortcutChord(event), 'Meta+Shift+r');
    assert.equal(shortcutActionForEvent(event, preferences), 'start');
    assert.equal(shortcutActionForEvent({ ...event, metaKey: false, shiftKey: false, key: 'r' }, preferences), undefined);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, menu: ['j'] } }), /already assigned/);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, menu: ['Meta+1'] } }), /reserved/);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, menu: ['Escape'] } }), /reserved/);
  });
});

describe('XLSX / CSV editor round trips', () => {
  it('preserves CSV leading zeros, quoted commas, newlines and edited values', async () => {
    const source = 'Name,ID,Notes\r\n"Doe, Alex",00123,"Line one\nLine two"\r\nNguyen,00005,plain';
    const document = await importSpreadsheet('people.csv', new TextEncoder().encode(source).buffer);
    assert.equal(cellText(document.sheets[0].rows[1].cells[1]), '00123');
    assert.equal(spreadsheetCsv(document.sheets[0]), source);
    const next = editSpreadsheetCell(document.sheets[0], 'row-1', 2, 'New, "quoted" note');
    const copy = await importSpreadsheet('copy.csv', new TextEncoder().encode(spreadsheetCsv(next)).buffer);
    assert.equal(copy.sheets[0].rows[1].cells[2].value, 'New, "quoted" note');
    assert.equal(document.sheets[0].rows[1].cells[2].value, 'Line one\nLine two');
  });
  it('retains RGB, theme and indexed fills after sort/edit/XLSX export, across sheets', async () => {
    const original = new Excel.Workbook(), sheet = original.addWorksheet('People');
    sheet.addRows([['Name', 'ID', 'Notes'], ['Zoe', '00002', 'last'], ['Alex', '00001', 'first']]);
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB7D7F0' } };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 4, tint: 0.4 } as Partial<Excel.Color> };
    sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { indexed: 3 } as Partial<Excel.Color> };
    original.addWorksheet('Other').getCell('B2').value = 'Keep';
    const source = bytes(await original.xlsx.writeBuffer() as unknown as Uint8Array);
    const document = await importSpreadsheet('source.xlsx', source);
    assert.equal(document.sheets[0].rows[0].cells[0].background, '#b7d7f0');
    assert.equal(document.sheets[0].rows[2].cells[0].background, '#00ff00');
    const sorted = sortSpreadsheet(document.sheets[0], 0, 'asc');
    assert.equal(sorted.rows[0].cells[0].value, 'Name');
    assert.equal(sorted.rows[1].cells[0].value, 'Alex');
    const next = editSpreadsheetCell(sorted, sorted.rows[1].id, 0, 'Alex edited');
    const data = await spreadsheetXlsx({ ...document, sheets: [next, document.sheets[1]] });
    const reloaded = await importSpreadsheet('edited.xlsx', data);
    assert.equal(reloaded.sheets.length, 2);
    assert.equal(reloaded.sheets[0].rows[1].cells[0].value, 'Alex edited');
    assert.deepEqual(reloaded.sheets[0].rows[1].cells[0].fill, document.sheets[0].rows[2].cells[0].fill);
    assert.equal(reloaded.sheets[0].rows[2].cells[0].background, document.sheets[0].rows[1].cells[0].background);
    assert.equal(reloaded.sheets[1].rows[1].cells[1].value, 'Keep');
    assert.equal((await importSpreadsheet('source.xlsx', source)).sheets[0].rows[1].cells[0].value, 'Zoe');
  });
  it('exports selected columns while keeping every data row', async () => {
    const document = newEditableWorkbook();
    const sheet = { ...document.sheets[0], hidden: [1] };
    assert.equal(spreadsheetCsv(sheet), 'Name,Notes\r\n,');
    const exported = await importSpreadsheet('copy.xlsx', await spreadsheetXlsx({ ...document, sheets: [sheet] }));
    assert.equal(exported.sheets[0].width, 2); assert.equal(exported.sheets[0].rows.length, 2);
  });
  it('shows stored formula results and emits value copies, never formula recalculation', async () => {
    const original = new Excel.Workbook(), sheet = original.addWorksheet('Values');
    sheet.getCell('A1').value = 'Total'; sheet.getCell('A2').value = { formula: '1+2', result: 3 };
    const document = await importSpreadsheet('formula.xlsx', bytes(await original.xlsx.writeBuffer() as unknown as Uint8Array));
    assert.equal(document.hasFormulas, true); assert.equal(document.sheets[0].rows[1].cells[0].value, 3);
    const exported = await importSpreadsheet('copy.xlsx', await spreadsheetXlsx(document));
    assert.equal(exported.hasFormulas, false); assert.equal(exported.sheets[0].rows[1].cells[0].value, 3);
  });
  it('refuses malformed files and unsupported colors explicitly', async () => {
    await assert.rejects(importSpreadsheet('bad.xlsx', new TextEncoder().encode('not a zip').buffer));
    await assert.rejects(importSpreadsheet('bad.txt', new ArrayBuffer(0)), /FORMAT_UNSUPPORTED/);
    assert.throws(() => spreadsheetColor({ theme: 100 }, []), /FILL_COLOR_UNSUPPORTED/);
  });
});
