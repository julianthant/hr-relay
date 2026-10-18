import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS, type CanonicalFieldId } from '../../../models/fields/registry.js';
import { isCellCoercionError } from '../../../models/fields/cell-coercion.js';
import { systemClock } from '../../../rules/time/clock.js';
import { WorkflowIdSchema, IntakeTargetFieldIdSchema } from '../../../rules/identity/ids.js';
import { z } from 'zod';

export type SpreadsheetFieldType = 'identifier' | 'name' | 'email' | 'phone' | 'date' | 'status' | 'text';
export interface SpreadsheetField {
  readonly id: string;
  readonly label: string;
  readonly type: SpreadsheetFieldType;
  readonly format: string;
  readonly aliases: readonly string[];
}
const DATE_FIELDS = new Set<CanonicalFieldId>(['dob', 'effectiveDate', 'hireDate', 'separationDate', 'lastDayWorked', 'signatureDate']);
const NAME_FIELDS = new Set<CanonicalFieldId>(['fullName', 'firstName', 'lastName', 'middleName', 'middleInitial', 'livedName', 'suffix', 'supervisor']);
const IDENTIFIER_FIELDS = new Set<CanonicalFieldId>(['eid', 'ppsEid', 'pid', 'ssn', 'deptId', 'departmentCode', 'jobCode', 'positionNumber', 'recruitmentNumber', 'kualiDocId', 'transactionNumber']);
const LABELS: Partial<Record<CanonicalFieldId, string>> = { eid: 'Employee ID', fullName: 'Legal name', livedName: 'Lived name', cellPhone: 'Phone', hireDate: 'Start date', supervisor: 'Supervisor name' };
const EXTRA_ALIASES: Partial<Record<CanonicalFieldId, readonly string[]>> = { eid: ['UCPath Empl ID'], transactionNumber: ['Transaction ID', 'Transaction No.', 'UCPath Transaction Number', 'UCPath Transaction ID', 'UCPath Transaction #'], livedName: ['Preferred name'], workLocation: ['Proposed location assignment'], hireDate: ['Start date', 'Employment date'], supervisor: ['Supervisor name'] };
const extra = (id: string, label: string, type: SpreadsheetFieldType, aliases: readonly string[] = [], format = type === 'status' ? 'Yes, No, Pending or Complete' : 'Text'): SpreadsheetField => ({ id: `roster.${id}`, label, type, aliases, format });

/** Canonical IDs are shared with intake; roster-only fields remain explicitly namespaced. */
export const SPREADSHEET_FIELDS: readonly SpreadsheetField[] = [
  ...CANONICAL_FIELD_IDS.map(id => {
    const type: SpreadsheetFieldType = DATE_FIELDS.has(id) ? 'date' : NAME_FIELDS.has(id) ? 'name' : /email/i.test(id) ? 'email' : /phone/i.test(id) ? 'phone' : IDENTIFIER_FIELDS.has(id) ? 'identifier' : 'text';
    return { id, label: LABELS[id] ?? CANONICAL_FIELDS[id].label, type,
      aliases: [...CANONICAL_FIELDS[id].aliases, ...(EXTRA_ALIASES[id] ?? [])],
      format: id === 'eid' ? '8 digits, starting with 10' : id === 'ssn' ? '9 digits' : id === 'transactionNumber' ? 'Starts with T' : type === 'date' ? 'MM/DD/YYYY or YYYY-MM-DD' : type === 'email' ? 'Email address' : type === 'phone' ? '7–15 digits' : type === 'identifier' ? 'Identifier stored as text' : 'Text',
    };
  }),
  extra('i9ProfileId', 'I-9 profile ID', 'identifier', ['I9 profile', 'I-9 profile', 'I9 profile number', 'I-9 profile number', 'I9 ID', 'I9 profile ID'], '6 or 7 digits'),
  extra('tsn', 'TSN', 'identifier', ['Temporary student number']),
  extra('personalPhone', 'Personal phone', 'phone'),
  extra('supervisorEmail', 'Supervisor email', 'email', ['Manager email'], 'Email address'),
  extra('initiator', 'Initiator', 'name'),
  extra('collegeOfResidence', 'College of residence', 'text'),
  extra('offerAccepted', 'Offer accepted', 'status'),
  extra('campusFormsPending', 'Campus forms pending', 'status'),
  extra('backgroundTermsAccepted', 'Background terms accepted', 'status', ['Background Check Accept Terms YN']),
  extra('backgroundEntered', 'Background entered', 'date', ['Date background entered'], 'MM/DD/YYYY or YYYY-MM-DD'),
  extra('backgroundCleared', 'Background cleared', 'status'),
  extra('enteredInUcpath', 'Entered in UCPath', 'status'),
  extra('readyForPayrollApproval', 'Ready for payroll approval', 'status'),
  extra('adSubmitted', 'AD submitted', 'status'),
  extra('adUsername', 'AD username', 'text'),
  extra('readyForSigning', 'Ready for signing', 'status'),
  extra('oathAddedToUcpath', 'Oath added to UCPath', 'status', ['Add oath to UCPath']),
  extra('hired', 'Hired', 'status'),
  extra('i9Status', 'I-9 status', 'status', ['I-9', 'I9']),
  extra('jolAndEmployeeDataForm', 'JOL and employee data form', 'text', ['G-Drive: JOL & EE Data Form', 'G Drive: JOL & EE Data Form', 'G:Drive: JOL & EE Data Form']),
  extra('notes', 'Notes', 'text', ['Note', 'Comments']),
];
export const spreadsheetHeaderKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '');
export function spreadsheetField(id: string): SpreadsheetField {
  const field = SPREADSHEET_FIELDS.find(entry => entry.id === id);
  if (!field) throw new Error('SPREADSHEET_FIELD_NOT_FOUND');
  return field;
}
export function fieldForSpreadsheetHeader(header: string): SpreadsheetField | undefined {
  const key = spreadsheetHeaderKey(header);
  if (!key) return undefined;
  const matches = SPREADSHEET_FIELDS.filter(field => [field.label, ...field.aliases].some(alias => spreadsheetHeaderKey(alias) === key));
  return matches.length === 1 ? matches[0] : undefined;
}
export function spreadsheetValueMatches(fieldId: string, raw: string): boolean {
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
