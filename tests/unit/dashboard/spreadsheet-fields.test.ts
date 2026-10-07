import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import { CANONICAL_FIELD_IDS } from '../../../src/domain/fields/registry.js';
import { SPREADSHEET_FIELDS, fieldForSpreadsheetHeader, spreadsheetValueMatches, suggestSpreadsheetField } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.js';
import { prepareSpreadsheetColumns, selectSpreadsheetColumns, setSpreadsheetColumnField, setSpreadsheetHeaderRow, spreadsheetColumnErrors } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-column-import-model.js';
import { addSpreadsheetColumn, editSpreadsheetCell, newEditableWorkbook, readSpreadsheetField, spreadsheetCellProblem, updateSpreadsheetFields, type EditableWorkbook } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { registerLocalSpreadsheet, registeredSpreadsheetWorkbook, retainSpreadsheetCopy, resetSpreadsheetMocks, searchMockSpreadsheet } from '../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';
afterEach(resetSpreadsheetMocks);
const book = (values: readonly (readonly string[])[]): EditableWorkbook => ({ name: 'Fictional.csv', themes: [], hasFormulas: false, sheets: [{ id: 'sheet', name: 'Roster', width: values[0].length, hidden: [], rows: values.map((cells, i) => ({ id: `row-${i}`, cells: cells.map(value => ({ value })) })) }] });
describe('typed spreadsheet field contract', () => {
  it('shares every canonical field ID and recognizes roster header aliases', () => {
    assert.equal(new Set(SPREADSHEET_FIELDS.map(field => field.id)).size, SPREADSHEET_FIELDS.length);
    for (const id of CANONICAL_FIELD_IDS) assert(SPREADSHEET_FIELDS.some(field => field.id === id), id);
    for (const [header, id] of Object.entries({ 'UCPath ID': 'eid', 'Legal Name': 'fullName', 'Preferred Name': 'livedName', 'Personal Email': 'personalEmail', 'Transaction #': 'transactionNumber', 'I9 Profile': 'roster.i9ProfileId', 'Supervisor Email': 'roster.supervisorEmail', 'Add Oath to UCPATH': 'roster.oathAddedToUcpath' })) assert.equal(fieldForSpreadsheetHeader(header)?.id, id, header);
    assert.equal(suggestSpreadsheetField('Unknown', ['10000001', '10000002']).fieldId, 'eid');
    assert.equal(suggestSpreadsheetField('Unknown', ['T123', 'T456']).fieldId, 'transactionNumber');
    for (const samples of [['123456'], ['student@example.com'], [''], ['10000001', '123']]) assert.equal(suggestSpreadsheetField('Unknown', samples).fieldId, null);
  });
  it('validates identifier shapes, contact details, dates and statuses while allowing missing future values', () => {
    const cases: readonly [string, string, boolean][] = [
      ['eid', '10000001', true], ['eid', '11000001', false], ['eid', '1000001', false], ['eid', '10abcdef', false],
      ['transactionNumber', 'T123ABC', true], ['transactionNumber', '12345', false], ['transactionNumber', 'T 123', false],
      ['roster.i9ProfileId', '123456', true], ['roster.i9ProfileId', '0123456', true], ['roster.i9ProfileId', '12345', false], ['roster.i9ProfileId', '12345678', false],
      ['personalEmail', 'student@example.com', true], ['personalEmail', 'invalid@', false], ['cellPhone', '(202) 555-0101', true], ['cellPhone', '555', false],
      ['hireDate', '10/19/2026', true], ['hireDate', '2026-10-19', true], ['hireDate', '02/30/2026', false], ['hireDate', '10/19/26', false],
      ['roster.hired', 'Yes', true], ['roster.hired', 'Pending', true], ['roster.hired', 'maybe', false],
    ];
    for (const [id, value, valid] of cases) assert.equal(spreadsheetValueMatches(id, value), valid, `${id}: ${value}`);
    for (const field of SPREADSHEET_FIELDS) assert(spreadsheetValueMatches(field.id, ''));
    assert.throws(() => spreadsheetValueMatches('unknown', ''), /SPREADSHEET_FIELD_NOT_FOUND/);
  });
  it('detects headers below a preamble and retains original column and header-row provenance', () => {
    const source = book([['Student applicants', '', '', ''], ['Oct 5', '', '', ''], ['Legal Name', 'UCPath ID', 'Personal Email', 'Unneeded'], ['Jordan Lee', '10000001', 'jordan@example.com', 'discarded']]);
    const pending = prepareSpreadsheetColumns(source), sheet = pending.sheets[0];
    assert.equal(sheet.headerRow, 3); assert.equal(sheet.columnBindings![1].fieldId, 'eid');
    assert.match(spreadsheetColumnErrors(pending).join(), /choose a field for column D/);
    const selected = selectSpreadsheetColumns({ ...pending, sheets: [{ ...sheet, hidden: [3] }] });
    assert.equal(selected.sheets[0].sourceHeaderRow, 3); assert.equal(selected.sheets[0].headerRow, 1);
    assert.deepEqual(selected.sheets[0].rows.map(row => row.id), ['row-2', 'row-3']);
    assert.equal(selected.sheets[0].columnBindings![1].sourceColumn, 1);
    assert.equal(selected.sheets[0].columnBindings![1].sourceHeader, 'UCPath ID');
    const changedHeader = setSpreadsheetHeaderRow(selected.sheets[0], 2);
    assert.equal(changedHeader.sourceHeaderRow, 4);
    assert.deepEqual(changedHeader.columnBindings!.map(binding => binding.id), selected.sheets[0].columnBindings!.map(binding => binding.id));
    assert(!JSON.stringify(selected).includes('discarded'));
    const manual = setSpreadsheetColumnField(sheet, 3, 'roster.notes');
    assert.equal(setSpreadsheetHeaderRow(manual, 2).columnBindings![3].fieldId, null);
    assert.throws(() => setSpreadsheetHeaderRow(sheet, 99), /SPREADSHEET_HEADER_ROW_INVALID/);
  });
  it('checks all data rows and rejects duplicate mappings only among kept columns', () => {
    const pending = prepareSpreadsheetColumns(book([['UCPath ID', 'Employee ID'], ...Array.from({ length: 30 }, () => ['10000001', '10000002']), ['99999999', '10000003']]));
    assert.match(spreadsheetColumnErrors(pending).join(), /mapped more than once/);
    assert.match(spreadsheetColumnErrors(pending).join(), /1 value does not match/);
    assert.throws(() => selectSpreadsheetColumns(pending), /SPREADSHEET_COLUMNS_INVALID/);
    assert.equal(spreadsheetColumnErrors({ ...pending, sheets: [{ ...pending.sheets[0], hidden: [0] }] }).length, 0);
  });
  it('reads and updates by field regardless of header text, retaining cell formatting and atomic refusal', () => {
    const source = newEditableWorkbook().sheets[0];
    const edited = editSpreadsheetCell(source, 'header', 1, 'Custom header');
    const filled = { ...edited, rows: edited.rows.map(row => row.id === 'row-1' ? { ...row, cells: row.cells.map((cell, i) => i === 1 ? { ...cell, background: '#ff0000' } : cell) } : row) };
    const result = updateSpreadsheetFields(filled, 'row-1', { eid: '10000001', 'roster.notes': 'Onboarding finished' });
    assert.equal(readSpreadsheetField(result, 'row-1', 'eid'), '10000001');
    assert.equal(result.rows[0].cells[1].value, 'Custom header'); assert.equal(result.rows[1].cells[1].background, '#ff0000');
    assert.throws(() => updateSpreadsheetFields(result, 'row-1', { 'roster.notes': 'changed', eid: 'invalid' }), /SPREADSHEET_FIELD_VALUE_INVALID/);
    assert.equal(readSpreadsheetField(result, 'row-1', 'roster.notes'), 'Onboarding finished');
    assert.throws(() => readSpreadsheetField(result, 'header', 'eid'), /SPREADSHEET_DATA_ROW_UNAVAILABLE/);
    assert.throws(() => readSpreadsheetField(result, 'row-1', 'personalEmail'), /SPREADSHEET_FIELD_BINDING_UNAVAILABLE/);
    const inserted = addSpreadsheetColumn(result, 'Extra');
    assert.equal(inserted.columnBindings!.length, inserted.width); assert.equal(inserted.columnBindings!.at(-1)!.fieldId, null);
    assert.notEqual(inserted.columnBindings!.at(-1)!.id, inserted.columnBindings![0].id);
  });
  it('retains mappings and real imported search values under the same library identity', () => {
    const source = selectSpreadsheetColumns(prepareSpreadsheetColumns(book([['Legal Name', 'UCPath ID'], ['Jordan Lee', '10000001']])));
    const file = registerLocalSpreadsheet(source);
    assert.equal(searchMockSpreadsheet(file, 'Roster', '10000001')[0]['Legal name'], 'Jordan Lee');
    const edited = { ...source, sheets: [editSpreadsheetCell(source.sheets[0], 'row-1', 1, '10000002')] };
    retainSpreadsheetCopy(file.id, edited);
    assert.equal(registeredSpreadsheetWorkbook(file).sheets[0].columnBindings![1].fieldId, 'eid');
    assert.equal(searchMockSpreadsheet(file, 'Roster', '10000002').length, 1);
    const remapped = { ...edited, sheets: [setSpreadsheetColumnField(edited.sheets[0], 1, 'roster.notes')] };
    const updated = registerLocalSpreadsheet(remapped, file.id);
    assert.equal(updated.id, file.id); assert.equal(updated.addedAt, file.addedAt);
    assert.equal(updated.sheets[0].bindings![1].fieldId, 'roster.notes');
    assert.throws(() => retainSpreadsheetCopy('unknown', source), /SPREADSHEET_NOT_FOUND/);
  });
});

describe('editor typed-cell problems', () => {
  it('names the bound field for a value import would refuse and stays silent otherwise', () => {
    const base = book([['Employee ID', 'Notes'], ['12345', 'x']]).sheets[0];
    const sheet = { ...base, columnBindings: [
      { id: 'eid', sourceColumn: 0, sourceHeader: 'Employee ID', fieldId: 'eid', basis: 'header' as const },
      { id: 'notes', sourceColumn: 1, sourceHeader: 'Notes', fieldId: null, basis: 'unmapped' as const },
    ] };
    assert.equal(spreadsheetCellProblem(sheet, 0, '12345'), 'Does not match Employee ID (8 digits, starting with 10).');
    assert.equal(spreadsheetCellProblem(sheet, 0, '10000001'), undefined);
    assert.equal(spreadsheetCellProblem(sheet, 0, ''), undefined);
    assert.equal(spreadsheetCellProblem(sheet, 1, 'anything'), undefined);
    assert.equal(spreadsheetCellProblem(base, 0, '12345'), undefined);
  });
});
