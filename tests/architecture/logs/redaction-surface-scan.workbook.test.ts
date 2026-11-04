import assert from 'node:assert/strict';
import { it } from 'vitest';
import { auditSurfaceOrigins, decidableLeaves, REDACTION_SURFACES, SURFACE_LEAF_ORIGINS } from './helpers/redaction-surface-audit.js';

it('pins all mutable type and values-action origins and rejects each omission or foreign egress', () => {
  const workbookPaths = [
    'libraryId', 'name', 'sheets[].columnBindings[].fieldId', 'sheets[].columnBindings[].id',
    'sheets[].columnBindings[].sourceHeader', 'sheets[].id', 'sheets[].name',
    'sheets[].rows[].cells[].background', 'sheets[].rows[].cells[].value',
    'sheets[].rows[].cells[].numFmt', 'sheets[].rows[].cells[].hyperlink', 'sheets[].rows[].cells[].tooltip',
    'sheets[].rows[].cells[].richText[].text', 'sheets[].rows[].cells[].richText[].font.name',
    'sheets[].rows[].id', 'themes', 'themes[]',
  ];
  const reviewed = [
    ...[
      ['wire/workbook-type', ''],
      ['wire/workbook-library-catalog', '[].type.'],
    ].flatMap(([surface, prefix]) => ['fieldLabels', 'requiredFields[]'].map(path => ({ surface, path: `${prefix}${path}` }))),
    ...[
      ['request/workbook-library-action', 'change.from.workbook.'],
      ['wire/workbook-library-action-status', 'record.action.change.from.workbook.'],
      ['durable/workbook-library-action', 'action.change.from.workbook.'],
    ].flatMap(([surface, prefix]) => workbookPaths.map(path => ({ surface, path: `${prefix}${path}` }))),
  ];
  assert.equal(reviewed.length, 55);
  const ids = new Set(reviewed.map(entry => entry.surface));
  const surfaces = REDACTION_SURFACES.filter(surface => ids.has(surface.id));
  assert.deepEqual(surfaces.map(surface => surface.id).sort(), [...ids].sort());
  for (const surface of surfaces) assert.equal(surface.egress, surface.id.startsWith('durable/') ? 'durable-authority' : 'operator-loopback');
  const origins = SURFACE_LEAF_ORIGINS.filter(entry => ids.has(entry.surface));
  assert.deepEqual(auditSurfaceOrigins(surfaces, origins), []);
  const newOrigins = origins.filter(entry => entry.path.includes('change.from.workbook.') || entry.path.endsWith('fieldLabels') || entry.path.endsWith('requiredFields[]'));
  assert.deepEqual(newOrigins.map(entry => `${entry.surface}|${entry.path}`).sort(), reviewed.map(entry => `${entry.surface}|${entry.path}`).sort());
  for (const entry of newOrigins) {
    assert.equal(entry.origin, 'captured-hr-value', `${entry.surface}|${entry.path}`);
    assert.equal(entry.exception, undefined);
    const missing = auditSurfaceOrigins(surfaces, origins.filter(candidate => candidate !== entry));
    assert.equal(missing.length, 1);
    assert.ok(missing[0]?.startsWith(`${entry.surface} (`));
    assert.ok(missing[0]?.includes(`leaf "${entry.path}"`));
    assert.match(missing[0] ?? '', /carries no declared origin/u);
  }
  for (const egress of ['process-egress', 'os-notification'] as const) {
    const violations = auditSurfaceOrigins(surfaces.map(surface => ({ ...surface, egress })), origins);
    for (const entry of newOrigins) assert.ok(violations.some(problem => problem.startsWith(`${entry.surface} (${egress}) leaf "${entry.path}"`)
      && problem.includes('may not carry at all')), `${egress}|${entry.surface}|${entry.path}`);
  }
});

it('keeps mutable editor metadata out of retained workbook references and start-plan reference origins', () => {
  const expected = ['id', 'name', 'keyFieldId', 'fields[]', 'defaultWorkbookId'].sort();
  for (const [id, prefix] of [
    ['wire/workbook-reference', 'type.'],
    ['wire/start-plan', 'planned[].workbookReferences[].type.'],
  ]) {
    const surface = REDACTION_SURFACES.find(surface => surface.id === id); assert.ok(surface);
    assert.deepEqual(decidableLeaves(surface.schema).filter(leaf => leaf.path.startsWith(prefix)).map(leaf => leaf.path.slice(prefix.length)).sort(), expected);
    assert.deepEqual(SURFACE_LEAF_ORIGINS.filter(entry => entry.surface === id && entry.path.startsWith(prefix)).map(entry => entry.path.slice(prefix.length)).sort(), expected);
  }
});
