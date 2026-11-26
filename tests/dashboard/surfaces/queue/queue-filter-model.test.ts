import assert from 'node:assert/strict';
import { describe,it } from 'vitest';
import { statusFilterValue, toggleQueueFilter } from '../../../../src/dashboard/surfaces/queue/queue-filter-model.js';

describe('Relay presentation models', () => {
  it('combines quick filters and returns to All after removing the last one', () => {
    assert.deepEqual(toggleQueueFilter(['all'], 'needsYou'), ['needsYou']);
    assert.deepEqual(toggleQueueFilter(['needsYou'], 'running'), ['needsYou', 'running']);
    assert.deepEqual(toggleQueueFilter(['needsYou', 'running'], 'needsYou'), ['running']);
    assert.deepEqual(toggleQueueFilter(['running'], 'running'), ['all']);
    assert.deepEqual(toggleQueueFilter(['failed', 'running'], 'all'), ['all']);
  });

  it('names the Status filter on its Options row', () => {
    const label = (status: string) => status.toUpperCase();
    assert.equal(statusFilterValue(['all'], label), 'All');
    assert.equal(statusFilterValue(['failed'], label), 'FAILED');
    assert.equal(statusFilterValue(['failed', 'running'], label), '2 selected');
  });
});
