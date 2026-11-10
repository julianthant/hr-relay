import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from '../../../models/fields/registry.js';
import { SPREADSHEET_FIELDS, fieldForSpreadsheetHeader, spreadsheetField } from '../../../models/fields/workbook-fields.js';
import { CustomRosterFieldIdSchema } from '../../../models/dashboard/workbooks.js';
import { isCellCoercionError } from '../../../models/fields/cell-coercion.js';
import { systemClock } from '../../../rules/time/clock.js';
import { WorkflowIdSchema, IntakeTargetFieldIdSchema } from '../../../rules/identity/ids.js';
import { z } from 'zod';

export function spreadsheetValueMatches(fieldId: string, raw: string): boolean {
  if (!SPREADSHEET_FIELDS.some(field => field.id === fieldId) && CustomRosterFieldIdSchema.safeParse(fieldId).success) return true;
  const field = spreadsheetField(fieldId), value = raw.trim();
  if (!value) return true;
  const canonicalId = CANONICAL_FIELD_IDS.find(id => id === fieldId);
  if (canonicalId === undefined) return true;
  const canonical = CANONICAL_FIELDS[canonicalId];
  try {
    canonical.schema.parse(canonical.coerce(value, { workflow: WorkflowIdSchema.parse('spreadsheet'), readAt: systemClock.now().toISOString(), sourceRow: 1, header: field.label, targetFieldId: IntakeTargetFieldIdSchema.parse(canonicalId) }));
  } catch (error) {
    if (isCellCoercionError(error) || error instanceof z.ZodError) return false;
    throw error;
  }
  return true;
}
export function spreadsheetEditorField(fieldId: string, label: string) {
  const known = SPREADSHEET_FIELDS.find(field => field.id === fieldId);
  if (known !== undefined) return known;
  if (CustomRosterFieldIdSchema.safeParse(fieldId).success) {
    if (!label.trim()) throw new Error('SPREADSHEET_FIELD_LABEL_MISSING');
    return { id: fieldId, label, type: 'text' as const, format: 'Text', aliases: [] };
  }
  return spreadsheetField(fieldId);
}
export function suggestSpreadsheetField(header: string, samples: readonly string[]): { fieldId: string | null; basis: 'header' | 'values' | 'unmapped' } {
  const field = fieldForSpreadsheetHeader(header);
  if (field) return { fieldId: field.id, basis: 'header' };
  // Numeric profile IDs, names and email ownership cannot be inferred from shape alone.
  const values = samples.map(value => value.trim()).filter(Boolean);
  if (values.length && values.every(value => /^10\d{6}$/u.test(value))) return { fieldId: 'eid', basis: 'values' };
  if (values.length && values.every(value => /^T\d+$/u.test(value))) return { fieldId: 'transactionNumber', basis: 'values' };
  return { fieldId: null, basis: 'unmapped' };
}

export interface SpreadsheetColumnBinding {
  readonly id: string;
  readonly sourceColumn: number | null;
  readonly sourceHeader: string;
  readonly fieldId: string | null;
  readonly basis: 'header' | 'values' | 'manual' | 'unmapped';
}
