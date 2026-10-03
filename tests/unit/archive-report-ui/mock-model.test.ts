import { describe, expect, it } from 'vitest';
import { MOCK_ARCHIVE_RUNS, MOCK_ARCHIVE_WORKFLOWS, mockArchiveDateBoundary, mockArchiveExport, mockArchiveFilter, mockArchiveScope } from '../../../src/dashboard/surfaces/archive-mock-model.js';
import { ArchiveBrowseStateSchema } from '../../../src/dashboard/app/archive-route-model.js';
import { mockArchiveLogs } from '../../../src/dashboard/surfaces/archive-mock-logs-model.js';
import { logPlainText } from '../../../src/dashboard/surfaces/log-feed-model.js';

describe('local Archive mock', () => {
 it('uses distinct fictional identities, several versions and all sample outcomes', () => {
  expect(MOCK_ARCHIVE_RUNS).toHaveLength(30);
  expect(new Set(MOCK_ARCHIVE_RUNS.map(row => row.id)).size).toBe(30);
  expect(new Set(MOCK_ARCHIVE_RUNS.map(row => row.dashboard))).toEqual(new Set(['1.3', '1.2', 'unrecorded']));
  for (const row of MOCK_ARCHIVE_RUNS) {
   expect(row.id).toMatch(/^archive-demo-run-/u);
   expect(row.employeeId).toMatch(/^DEMO-/u);
   expect(row.email).toMatch(/@example\.com$/u);
   expect(row.files[0].content).toContain('Fictional Archive mock');
  }
  for (const workflow of MOCK_ARCHIVE_WORKFLOWS) {
   const rows = mockArchiveScope({ dashboardKey: '1.3', workflow: workflow.id });
   expect(rows).toHaveLength(4);
   expect(new Set(rows?.map(row => row.outcome))).toEqual(new Set(['verifiedDone', 'doneWarnings', 'failed', 'cancelled']));
  }
 });
 it('does not substitute a valid folder for an unknown historical identity', () => {
  expect(mockArchiveScope({ dashboardKey: '1.0', workflow: MOCK_ARCHIVE_WORKFLOWS[0].id })).toBeNull();
  expect(mockArchiveScope({ dashboardKey: '1.3', workflow: 'retired-real-workflow' })).toBeNull();
 });
 it('searches names, IDs, saved fields and settings without exposing other scopes', () => {
  const rows = mockArchiveScope({ dashboardKey: '1.3', workflow: MOCK_ARCHIVE_WORKFLOWS[0].id })!;
  expect(mockArchiveFilter(rows, { filters: { search: ' jordan LEE ' } }).map(row => row.person)).toEqual(['Jordan Lee']);
  expect(mockArchiveFilter(rows, { filters: { search: 'DEMO-DOC-48220' } }).map(row => row.person)).toEqual(['Sam Rivera']);
  expect(mockArchiveFilter(rows, { filters: { search: 'Headed' } })).toHaveLength(4);
  expect(mockArchiveFilter(rows, { filters: { search: 'Robin Cooper' } })).toHaveLength(4);
  expect(mockArchiveFilter(rows, { filters: { search: 'no matching subject' } })).toEqual([]);
 });
 it('intersects inclusive date bounds and wire outcome filters, including done warnings', () => {
  const rows = mockArchiveScope({ dashboardKey: '1.3', workflow: MOCK_ARCHIVE_WORKFLOWS[0].id })!;
  const browse = ArchiveBrowseStateSchema.parse({ filters: { outcome: 'done', from: mockArchiveDateBoundary('2026-09-24'), to: mockArchiveDateBoundary('2026-09-25', true) } });
  expect(mockArchiveFilter(rows, browse).map(row => row.person)).toEqual(['Jordan Lee', 'Sam Rivera']);
  expect(mockArchiveFilter(rows, { filters: { outcome: 'failed' } }).map(row => row.person)).toEqual(['Drew Ellis']);
  expect(mockArchiveFilter(rows, { filters: { outcome: 'discarded' } })).toEqual([]);
  expect(ArchiveBrowseStateSchema.safeParse({ filters: { from: mockArchiveDateBoundary('2026-09-25'), to: mockArchiveDateBoundary('2026-09-24', true) } }).success).toBe(false);
 });
 it('keeps not-started steps and additional evidence in failed and cancelled reports', () => {
  const failed = MOCK_ARCHIVE_RUNS.find(row => row.outcome === 'failed')!;
  const cancelled = MOCK_ARCHIVE_RUNS.find(row => row.outcome === 'cancelled')!;
  expect(failed.steps.at(-1)?.status).toBe('notStarted');
  expect(failed.steps.at(-2)?.status).toBe('failed');
  expect(failed.files).toHaveLength(3);
  expect(cancelled.steps.slice(2).every(step => step.status === 'notStarted' && step.duration === '—')).toBe(true);
 });
 it('exports exactly the filtered selection and escapes CSV quotes and commas', () => {
  const source = MOCK_ARCHIVE_RUNS[0];
  const rows = [{ ...source, person: 'Lee, "Jordan"' }];
  expect(mockArchiveExport(rows, 'csv')).toContain('"Lee, ""Jordan"""');
  expect(mockArchiveExport(rows, 'csv').split('\r\n')).toHaveLength(2);
  expect(JSON.parse(mockArchiveExport(rows, 'json'))).toEqual({ mock: true, records: rows });
 });
 it('keeps saved log actions, captures and timeline aligned with every report outcome', () => {
  for (const run of MOCK_ARCHIVE_RUNS) {
   const logs = mockArchiveLogs(run);
   expect(logs.timeline).toHaveLength(run.steps.length);
   expect(logs.steps).toHaveLength(run.steps.filter(step => step.status !== 'notStarted').length);
   expect(logPlainText(logs.steps)).toContain(run.person);
   expect(logPlainText(logs.steps)).toContain(run.employeeId);
   for (const stage of logs.timeline) {
    if (stage.state === 'pending') expect(stage.stepId).toBeUndefined();
    else expect(logs.steps.some(step => step.id === stage.stepId)).toBe(true);
   }
   const events = logs.steps.flatMap(step => step.entries);
   const decisions = events.filter(entry => entry.kind === 'decision');
   expect(decisions).toHaveLength(run.outcome === 'failed' || run.outcome === 'doneWarnings' ? 1 : 0);
   for (const entry of decisions) if (entry.kind === 'decision') expect(entry.decision.actions).toBeUndefined();
   for (const entry of events) if (entry.kind === 'fields') {
    const capture = decodeURIComponent(entry.screenshots![0].src);
    expect(capture).toContain('FICTIONAL SAMPLE');
    expect(capture).toContain(run.employeeId);
   }
   const timestamps = events.flatMap(entry => entry.kind === 'fields' ? entry.fields.map(field => field.time) : [entry.time]);
   expect([...timestamps].sort()).toEqual(timestamps);
   expect(timestamps.at(-1)).toBe(new Date(run.completed).toISOString().slice(11, 19));
   if (run.outcome === 'cancelled') expect(logPlainText(logs.steps)).toContain('Remaining steps were not started');
  }
 });
});
