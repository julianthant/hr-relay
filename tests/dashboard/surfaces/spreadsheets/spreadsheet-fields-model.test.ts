import assert from 'node:assert/strict';
import { afterEach,describe,it } from 'vitest';
import { SPREADSHEET_FIELDS,fieldForSpreadsheetHeader,spreadsheetValueMatches,suggestSpreadsheetField } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.js';
import { resetSpreadsheetMocks } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-mock-model.js';
import { CANONICAL_FIELD_IDS } from '../../../../src/models/fields/registry.js';
afterEach(resetSpreadsheetMocks);
describe('typed spreadsheet field contract', () => {
  it('shares every canonical field ID and recognizes roster header aliases', () => {
    assert.equal(new Set(SPREADSHEET_FIELDS.map(field => field.id)).size, SPREADSHEET_FIELDS.length);
    for (const id of CANONICAL_FIELD_IDS) assert(SPREADSHEET_FIELDS.some(field => field.id === id), id);
    for (const [header, id] of Object.entries({ 'UCPath ID': 'eid', 'Legal Name': 'fullName', 'Preferred Name': 'livedName', 'Personal Email': 'personalEmail', 'Transaction #': 'transactionNumber', 'UCPath Transaction ID': 'transactionNumber', 'UCPath Empl ID': 'eid', 'I9 Profile': 'roster.i9ProfileId', 'Supervisor Email': 'roster.supervisorEmail', 'Add Oath to UCPATH': 'roster.oathAddedToUcpath' })) assert.equal(fieldForSpreadsheetHeader(header)?.id, id, header);
    assert.equal(suggestSpreadsheetField('Unknown', ['10000001', '10000002']).fieldId, 'eid');
    assert.equal(suggestSpreadsheetField('Unknown', ['T123', 'T456']).fieldId, 'transactionNumber');
    for (const samples of [['123456'], ['student@example.com'], [''], ['10000001', '123']]) assert.equal(suggestSpreadsheetField('Unknown', samples).fieldId, null);
  });
  it('validates identifier shapes, contact details, dates and statuses while allowing missing future values', () => {
    const cases: readonly [string, string, boolean][] = [
      ['eid', '10000001', true], ['eid', '10-000-001', true], ['eid', '11000001', false], ['eid', '1000001', false], ['eid', '10abcdef', false],
      ['transactionNumber', 'T123ABC', true], ['transactionNumber', '12345', true], ['transactionNumber', 'T 123', true],
      ['roster.i9ProfileId', '123456', true], ['roster.i9ProfileId', '0123456', true], ['roster.i9ProfileId', '12345', true], ['roster.i9ProfileId', '12345678', true],
      ['personalEmail', 'student@example.com', true], ['personalEmail', 'invalid@', false], ['cellPhone', '(202) 555-0101', true], ['cellPhone', '555', false],
      ['hireDate', '10/19/2026', true], ['hireDate', '2026-10-19', true], ['hireDate', '02/30/2026', false], ['hireDate', '10/19/26', true],
      ['roster.hired', 'Yes', true], ['roster.hired', 'Pending', true], ['roster.hired', 'maybe', true],
    ];
    for (const [id, value, valid] of cases) assert.equal(spreadsheetValueMatches(id, value), valid, `${id}: ${value}`);
    for (const field of SPREADSHEET_FIELDS) assert(spreadsheetValueMatches(field.id, ''));
    assert.throws(() => spreadsheetValueMatches('unknown', ''), /SPREADSHEET_FIELD_NOT_FOUND/);
  });
});
