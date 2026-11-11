import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { newEditableWorkbook } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import { datasetOf, mappingOf, withMapping } from '../../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-model.js';

describe('sheets-v2 model', () => {
  it('keeps header labels unique even when a literal suffix collides with a generated one', () => {
    const base = newEditableWorkbook().sheets[0], row = base.rows[(base.headerRow ?? 1) - 1];
    const cells = ['Name', 'Name', 'Name (2)'].map((text, index) => ({ ...row.cells[0], ...row.cells[index], value: text }));
    const sheet = { ...base, width: 3, rows: [{ ...row, cells }, ...base.rows.slice(1)] };
    const { headers } = datasetOf(sheet);
    assert.equal(new Set(headers).size, 3);
    const mapped = withMapping(sheet, { eid: headers[2] });
    assert.equal(mappingOf(mapped, [{ key: 'eid', label: 'Employee ID' }]).eid, headers[2]);
  });
});
