// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it } from 'vitest';
import { LogDecisionBlock } from '../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js';
import { workbookReferenceLogDecision } from '../../../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js';
import { workbookReferenceChoice } from '../../../../support/fixtures/workbook-reference-choice.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('draws roster rows as a pick, and refuses stale authority', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const answers: unknown[] = [], onAnswer = (_option: unknown, answer: unknown) => { answers.push(answer); };
  const decision = workbookReferenceLogDecision(workbookReferenceChoice().choice);
  const confirm = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Confirm');
  const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  try {
    await act(async () => root.render(createElement(LogDecisionBlock, { decision, onAnswer })));
    assert.match(host.textContent ?? '', /July 6 · Row 2/); assert.match(host.textContent ?? '', /Example, Person/);
    assert(confirm()?.disabled);
    await act(async () => radios()[0].click()); assert.equal(confirm()?.disabled, false);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => confirm()?.click()); assert.deepEqual(answers, [{ candidate: 'july/person-1' }]);
    await act(async () => root.render(createElement(LogDecisionBlock, { decision })));
    assert(radios().every(radio => radio.disabled)); assert(confirm()?.disabled);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
