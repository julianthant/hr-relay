// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it } from 'vitest';
import { LogDecisionBlock } from '../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js';
import { workbookReferenceLogDecision } from '../../../../../src/dashboard/surfaces/run-detail/logs/workbook-write-model.js';
import { workbookReferenceChoice } from '../../../../support/fixtures/workbook-reference-choice.js';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('keeps roster radio choices inline, refuses stale authority and resets selection with the served generation', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const answers: unknown[] = [], onAction = (_action: unknown, answer: unknown) => { answers.push(answer); };
  const decision = workbookReferenceLogDecision(workbookReferenceChoice().choice);
  try {
    await act(async () => root.render(createElement(LogDecisionBlock, { decision, onAction })));
    assert.match(host.textContent ?? '', /Legal name: Example, Person/);
    const button = host.querySelector('button[type="submit"]'); assert(button instanceof HTMLButtonElement); assert(button.disabled);
    const radio = host.querySelector('input[type="radio"]'); assert(radio instanceof HTMLInputElement);
    await act(async () => radio.click()); assert.equal(button.disabled, false);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => button.click()); assert.deepEqual(answers, [{ candidate: JSON.stringify(['july', 'person-1']) }]);
    await act(async () => root.render(createElement(LogDecisionBlock, { decision: workbookReferenceLogDecision(workbookReferenceChoice(5).choice), onAction })));
    assert.equal(host.querySelector('input:checked'), null); assert(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled);
    await act(async () => root.render(createElement(LogDecisionBlock, { decision })));
    assert(host.querySelector('fieldset')?.disabled); assert(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
