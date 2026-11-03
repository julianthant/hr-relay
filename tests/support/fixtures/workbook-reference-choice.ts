import { RunWorkbookWritesWireSchema } from '../../../src/models/dashboard/run-detail.js';
import { HASH_A, UUID_1, UUID_2 } from './phase1c-contract-fixtures.js';
export function workbookReferenceChoice(version = 4) {
  const target = { runId: UUID_1, expectedVersion: version, libraryId: UUID_2, typeId: 'roster', referenceDigest: HASH_A,
    key: 'example@example.edu', workbookVersion: version - 1, gateId: 'choose-roster-row' };
  const section = RunWorkbookWritesWireSchema.parse({ runId: UUID_1, operations: [], referenceChoices: [{
    libraryId: target.libraryId, typeId: target.typeId, referenceDigest: target.referenceDigest, key: target.key, reason: 'row-ambiguous',
    resolution: { state: 'available', target, candidates: [
      { sheetId: 'july', rowId: 'person-1', label: 'July 6 · Row 2', values: [{ fieldId: 'email', value: target.key }, { fieldId: 'fullName', value: 'Example, Person' }] },
      { sheetId: 'august', rowId: 'person-2', label: 'August 2 · Row 3', values: [{ fieldId: 'email', value: target.key }, { fieldId: 'fullName', value: 'Another, Person' }] },
    ], action: { kind: 'command', command: 'resolve-workbook-reference-row', key: 'choose-roster-row', label: 'Choose row', intent: 'primary', placement: ['review'], expectedVersion: target.expectedVersion, referenceTarget: target } },
  }] });
  const choice = section.referenceChoices?.[0];
  if (!choice || choice.resolution.state !== 'available' || choice.resolution.action.kind !== 'command') throw new Error('reference choice fixture invalid');
  return { choice, target, action: choice.resolution.action, candidates: choice.resolution.candidates };
}
