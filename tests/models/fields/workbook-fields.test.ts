import assert from 'node:assert/strict';
import { it } from 'vitest';
import { CANONICAL_FIELD_IDS } from '../../../src/models/fields/registry.js';
import { SPREADSHEET_FIELDS, spreadsheetField } from '../../../src/models/fields/workbook-fields.js';

it('offers every canonical and declared workflow roster field from one strict catalog', () => {
  const ids = SPREADSHEET_FIELDS.map(field => field.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of CANONICAL_FIELD_IDS) assert(ids.includes(id), id);
  for (const id of ['roster.livedFirstName', 'roster.livedLastName', 'roster.livedMiddleName', 'roster.action']) {
    assert.equal(spreadsheetField(id).id, id);
  }
  assert.throws(() => spreadsheetField('roster.unrecognized'), /SPREADSHEET_FIELD_NOT_FOUND/);
});
