import assert from 'node:assert/strict';
import { it } from 'vitest';
import { displayExtractedDate,formatCalendarDate,formatDay,formatDayTime,formatDuration,formatInstantDate,formatLocalDay,formatMonthDay,formatMonthYear,formatTime,formatTimeWithSeconds,formatWeekday } from '../../../src/dashboard/lib/date-format.js';
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
const LA = 'America/Los_Angeles';
const NOW = new Date('2026-11-19T12:00:00Z');
it('formats a time on the 12-hour clock, with seconds only where asked', () => {
  const rows: readonly (readonly [string, string, string])[] = [
    ['2026-11-18T21:55:00Z', '1:55 PM', '1:55:00 PM'],
    ['2026-11-18T22:00:02Z', '2:00 PM', '2:00:02 PM'],
    ['2026-11-18T08:00:00Z', '12:00 AM', '12:00:00 AM'],
    ['2026-11-18T20:00:00Z', '12:00 PM', '12:00:00 PM'],
    ['2026-11-18T07:59:59Z', '11:59 PM', '11:59:59 PM'],
    ['2026-11-18T17:05:09Z', '9:05 AM', '9:05:09 AM'],
  ];
  for (const [iso, short, long] of rows) {
    assert.equal(formatTime(iso, LA), short);
    assert.equal(formatTimeWithSeconds(iso, LA), long);
    assert.ok(!/[^\x20-\x7e]/u.test(short + long), 'plain ASCII spaces only');
  }
  assert.equal(formatTime(new Date('2026-11-18T21:55:00Z'), LA), '1:55 PM');
  assert.throws(() => formatTime('invalid'), /DASHBOARD_INSTANT_DATE_INVALID/);
});
it('formats a day with its year, and a day-time with the year only outside the current one', () => {
  assert.equal(formatDay('2026-11-18T22:19:00Z', LA), 'Nov 18, 2026');
  assert.equal(formatDay('2025-01-01T03:00:00Z', LA), 'Dec 31, 2024');
  assert.equal(formatDayTime('2026-11-18T22:19:00Z', LA, NOW), 'Nov 18, 2:19 PM');
  assert.equal(formatDayTime('2025-11-18T22:19:00Z', LA, NOW), 'Nov 18, 2025, 2:19 PM');
  assert.equal(formatDayTime('2026-01-01T07:30:00Z', LA, NOW), 'Dec 31, 2025, 11:30 PM');
  assert.equal(formatDayTime('2026-11-19T08:00:00Z', LA, NOW), 'Nov 19, 12:00 AM');
});
it('formats durations compactly', () => {
  const rows: readonly (readonly [number, string])[] = [
    [0, '<1s'], [0.4, '<1s'], [0.99, '<1s'], [1, '1s'], [7, '7s'], [59, '59s'], [59.6, '1m 00s'], [60, '1m 00s'],
    [407, '6m 47s'], [3599, '59m 59s'], [3600, '1h 00m'], [3840, '1h 04m'], [7260, '2h 01m'], [-9, '-9s'], [-525, '-8m 45s'],
  ];
  for (const [seconds, text] of rows) assert.equal(formatDuration(seconds), text, String(seconds));
});
it('formats calendar headings and local days in the given zone', () => {
  assert.equal(formatWeekday('2026-09-20T12:00:00Z', 'UTC', 'short'), 'Sun');
  assert.equal(formatWeekday('2026-09-20T03:00:00Z', LA, 'long'), 'Saturday');
  assert.equal(formatMonthDay('2026-09-20T12:00:00Z', 'UTC', 'short'), 'Sep 20');
  assert.equal(formatMonthDay('2026-09-20T12:00:00Z', 'UTC', 'long'), 'September 20');
  assert.equal(formatMonthYear('2026-09'), 'September 2026');
  assert.equal(formatLocalDay('2026-09-18T06:00:00Z', 'Asia/Tokyo'), '2026-09-18');
  assert.equal(formatLocalDay('2026-09-18T06:00:00Z', LA), '2026-09-17');
});
