import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { OperationValueIdSchema, OperationIdSchema } from '../../../src/domain/workflow/operation-display.js';
import { displayConditionMatches, renderDisplayTemplate, type DisplayTemplate } from '../../../src/dashboard/surfaces/explorer/operation-template-model.js';

const flag = OperationValueIdSchema.parse('flag');
const text = OperationValueIdSchema.parse('text');
const template: DisplayTemplate = {
  id: OperationIdSchema.parse('public-preview'), variables: [{ id: text, slot: text }], join: { separator: ' | ', trim: 'segments' },
  segments: [{ kind: 'literal', value: ' Start ' }, { kind: 'optional', when: { kind: 'equals', variable: flag, value: true }, segments: [
    { kind: 'variable', variable: text }, { kind: 'optional', when: { kind: 'is-present', variable: text }, segments: [{ kind: 'literal', value: ' End ' }] },
  ] }],
};

describe('sanitized display templates', () => {
  it('compares public primitive types exactly, including null and false', () => {
    for (const value of [true, false, null, 'ready']) {
      const condition = { kind: 'equals' as const, variable: flag, value };
      assert.equal(displayConditionMatches(condition, { flag: value }), true);
      assert.equal(displayConditionMatches(condition, { flag: undefined }), false);
      if (typeof value !== 'string') assert.equal(displayConditionMatches(condition, { flag: String(value) }), false);
      assert.equal(displayConditionMatches({ ...condition, kind: 'not-equals' }, { flag: value }), false);
    }
    assert.equal(displayConditionMatches({ kind: 'is-present', variable: flag }, { flag: false }), true);
    assert.equal(displayConditionMatches({ kind: 'is-absent', variable: flag }, { flag: '' }), true);
  });
  it('reduces nested public conditions then uses the canonical join and trim rules', () => {
    const before = JSON.stringify(template);
    assert.equal(renderDisplayTemplate(template, { flag: true, text: ' Middle ' }), 'Start | Middle | End');
    assert.equal(renderDisplayTemplate(template, { flag: 'true' }), 'Start');
    assert.equal(renderDisplayTemplate({ ...template, join: { separator: '', trim: 'outer' } }, { flag: false }), 'Start');
    assert.equal(JSON.stringify(template), before);
  });
  it('keeps missing referenced values loud and never guesses withheld values', () => {
    assert.throws(() => renderDisplayTemplate(template, { flag: true }), /cannot render missing variable "text"/u);
    assert.equal(renderDisplayTemplate(template, {}), 'Start');
    assert.equal(renderDisplayTemplate({ ...template, segments: [{ kind: 'variable', variable: 'flag' }] }, { flag: false }), 'false');
  });
});
