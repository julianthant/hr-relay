import { renderOperationTemplate, type OperationTemplateSegment } from '../../../domain/workflow/operation-display.js';
import type { WorkflowOperationDisplaySnapshot } from '../../../domain/workflow/operation-display-snapshot.js';

export type DisplayTemplate = WorkflowOperationDisplaySnapshot['invocations'][number]['operation']['templates'][number];
type DisplayCondition = NonNullable<WorkflowOperationDisplaySnapshot['invocations'][number]['operation']['actions'][number]['outcomes']>[number]['when'];
export type DisplayTemplateValue = string | boolean | null | undefined;

export function displayConditionMatches(condition: DisplayCondition, values: Readonly<Record<string, DisplayTemplateValue>>): boolean {
  const value = values[condition.variable];
  switch (condition.kind) {
    case 'is-present': return value !== undefined && value !== '';
    case 'is-absent': return value === undefined || value === '';
    case 'equals': return value === condition.value;
    case 'not-equals': return value !== condition.value;
  }
}

export function renderDisplayTemplate(template: DisplayTemplate, values: Readonly<Record<string, DisplayTemplateValue>>): string {
  const visible = (segments: readonly DisplayTemplate['segments'][number][]): readonly OperationTemplateSegment[] => segments.flatMap(segment =>
    segment.kind === 'optional' ? displayConditionMatches(segment.when, values) ? visible(segment.segments) : [] : [segment]);
  const text = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === undefined || typeof value === 'string' ? value : JSON.stringify(value)]));
  return renderOperationTemplate({ ...template, segments: visible(template.segments) }, text);
}
