import assert from 'node:assert/strict';
import { it } from 'vitest';
import { displayExtractedDate,formatCalendarDate,formatInstantDate } from '../../../src/dashboard/lib/date-format.js';
it('formats calendar days without timezone shifts and rejects rolled-over dates', () => {
  assert.equal(formatCalendarDate('2026-08-03'), '08/03/2026');
  assert.equal(formatCalendarDate('2024-02-29'), '02/29/2024');
  for (const value of ['2026-02-29', '2026-13-01', '2026-8-3', 'invalid']) assert.throws(() => formatCalendarDate(value), /DASHBOARD_CALENDAR_DATE_INVALID/);
});
it('formats instants in the selected timezone while keeping uncertain OCR dates unchanged', () => {
  assert.equal(formatInstantDate('2026-08-03T01:00:00Z', 'America/Los_Angeles'), '08/02/2026');
  assert.equal(formatInstantDate('2026-08-03T01:00:00Z', 'UTC'), '08/03/2026');
  assert.throws(() => formatInstantDate('invalid'), /DASHBOARD_INSTANT_DATE_INVALID/);
  assert.equal(displayExtractedDate('2026-04-23'), '04/23/2026');
  assert.equal(displayExtractedDate('4/23/2026'), '04/23/2026');
  assert.equal(displayExtractedDate('4-23-2026'), '04/23/2026');
  for (const value of ['4-23-26', '04/27/26', '02/30/2026', '']) assert.equal(displayExtractedDate(value), value);
});
