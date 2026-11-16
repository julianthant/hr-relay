import assert from 'node:assert/strict';
import { afterEach,describe,it } from 'vitest';
import { spreadsheetEditorField,spreadsheetValueMatches,suggestSpreadsheetField } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.js';
import { SPREADSHEET_FIELDS,fieldForSpreadsheetHeader } from '../../../../src/models/fields/workbook-fields.js';
import { resetSpreadsheetMocks } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';
import { CANONICAL_FIELD_IDS } from '../../../../src/models/fields/registry.js';
afterEach(resetSpreadsheetMocks);
describe('typed spreadsheet field contract', () => {
  it('presents validated saved custom roster fields from their actual header without making them workflow fields', () => {
    assert.equal(spreadsheetEditorField('roster.customTracker', 'Tracker status').label, 'Tracker status');
    assert.equal(spreadsheetValueMatches('roster.customTracker', 'any tracker value'), true);
    assert.throws(() => spreadsheetEditorField('roster.customTracker', ''), /SPREADSHEET_FIELD_LABEL_MISSING/u);
    assert.throws(() => spreadsheetEditorField('roster.bad-id', 'Tracker status'), /SPREADSHEET_FIELD_NOT_FOUND/u);
    assert.equal(spreadsheetEditorField('roster.backgroundEntered', 'Wrong label').type, 'date');
    assert.equal(spreadsheetEditorField('roster.backgroundEntered', 'Wrong label').label, 'Background entered');
    assert.equal(spreadsheetEditorField('roster.offerAccepted', 'Wrong label').type, 'status');
  });
  it('shares every canonical field ID and recognizes roster header aliases', () => {
    assert.equal(new Set(SPREADSHEET_FIELDS.map(field => field.id)).size, SPREADSHEET_FIELDS.length);
    for (const id of CANONICAL_FIELD_IDS) assert(SPREADSHEET_FIELDS.some(field => field.id === id), id);
    for (const [header, id] of Object.entries({ 'UCPath ID': 'eid', 'Legal Name': 'fullName', 'Preferred Name': 'livedName', 'Personal Email': 'personalEmail', 'Transaction #': 'transactionNumber', 'UCPath Transaction ID': 'transactionNumber', 'UCPath Empl ID': 'eid', 'I9 Profile': 'i9ProfileId', 'Tracker Profile ID': 'i9ProfileId', 'I-9 profile ID': 'i9ProfileId', 'Supervisor Email': 'roster.supervisorEmail', 'Add Oath to UCPATH': 'roster.oathAddedToUcpath' })) assert.equal(fieldForSpreadsheetHeader(header)?.id, id, header);
    assert.equal(suggestSpreadsheetField('Unknown', ['10000001', '10000002']).fieldId, 'eid');
    assert.equal(suggestSpreadsheetField('Unknown', ['T123', 'T456']).fieldId, 'transactionNumber');
    for (const samples of [['123456'], ['student@example.com'], [''], ['10000001', '123']]) assert.equal(suggestSpreadsheetField('Unknown', samples).fieldId, null);
  });
  it('maps the real Onboarding roster columns, including the misspelt transaction column only by its T-number samples', () => {
    for (const [header, fieldId] of [['Legal Name', 'fullName'], ['Lived Name', 'livedName'], ['UCPath ID', 'eid'], ['Transaction #', 'transactionNumber']]) {
      assert.deepEqual(suggestSpreadsheetField(header, []), { fieldId, basis: 'header' }, header);
    }
    assert.deepEqual(suggestSpreadsheetField('Transacton #', ['T009000001', ' T009000002 ', '']), { fieldId: 'transactionNumber', basis: 'values' });
    assert.deepEqual(suggestSpreadsheetField('Transacton #', []), { fieldId: null, basis: 'unmapped' });
  });
  it('validates identifier shapes, contact details, dates and statuses while allowing missing future values', () => {
    const cases: readonly [string, string, boolean][] = [
      ['eid', '10000001', true], ['eid', '10-000-001', true], ['eid', '11000001', false], ['eid', '1000001', false], ['eid', '10abcdef', false],
      ['transactionNumber', 'T123ABC', true], ['transactionNumber', '12345', true], ['transactionNumber', 'T 123', true],
      ['i9ProfileId', '123456', true], ['i9ProfileId', '0123456', false], ['i9ProfileId', '12345', true], ['i9ProfileId', '12345678', true], ['i9ProfileId', 'not-a-profile', false],
      ['personalEmail', 'student@example.com', true], ['personalEmail', 'invalid@', false], ['cellPhone', '(202) 555-0101', true], ['cellPhone', '555', false],
      ['hireDate', '10/19/2026', true], ['hireDate', '2026-10-19', true], ['hireDate', '02/30/2026', false], ['hireDate', '10/19/26', true],
      ['roster.hired', 'Yes', true], ['roster.hired', 'Pending', true], ['roster.hired', 'maybe', true],
    ];
    for (const [id, value, valid] of cases) assert.equal(spreadsheetValueMatches(id, value), valid, `${id}: ${value}`);
    for (const field of SPREADSHEET_FIELDS) assert(spreadsheetValueMatches(field.id, ''));
    assert.throws(() => spreadsheetValueMatches('unknown', ''), /SPREADSHEET_FIELD_NOT_FOUND/);
  });
});
