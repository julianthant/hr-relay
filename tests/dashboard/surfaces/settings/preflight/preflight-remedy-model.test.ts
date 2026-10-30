import assert from 'node:assert/strict';
import { it } from 'vitest';
import { preflightRemedy,preflightRemedyLabel } from '../../../../../src/dashboard/surfaces/settings/preflight/preflight-remedy-model.js';

it('maps known checks to available Settings sections and preserves a general destination for new checks', () => {
  for (const [id, destination, label] of [
    ['secrets.ucpath-sso', 'credentials', 'Configure credentials'],
    ['secrets.timekeeper', 'credentials', 'Configure credentials'],
    ['secrets.sharepoint-roster', 'routes', 'Configure SharePoint route'],
    ['authority.health', 'storage', 'Open Storage'],
    ['filesystem.health', 'storage', 'Open Storage'],
    ['fiscal.current', 'settings', 'Open Settings'],
    ['new.check', 'settings', 'Open Settings'],
  ] as const) {
    assert.equal(preflightRemedy(id), destination);
    assert.equal(preflightRemedyLabel(preflightRemedy(id)), label);
  }
});
