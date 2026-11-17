import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { preflightRemedy,preflightRemedyLabel,RUN_CHECK_FIXES,runCheckFix } from '../../../../../src/dashboard/surfaces/settings/preflight/preflight-remedy-model.js';
import { CHECK_COPY } from '../../../../../src/dashboard/surfaces/settings/preflight/preflight-check-copy.js';
import { buildSettingsNav,resolveSettingsSection } from '../../../../../src/dashboard/surfaces/settings/settings-model.js';
import { PREFLIGHT_CHECKS } from '../../../../../src/models/runtime/runtime-dependencies.js';

it('maps known checks to available Settings sections and preserves a general destination for new checks', () => {
  for (const [id, destination, label] of [
    ['secrets.ucpath-sso', 'credentials', 'Configure credentials'],
    ['profile.identity', 'settings', 'Open Settings'],
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

describe('the Run dialog Fix mapping', () => {
  const ids = PREFLIGHT_CHECKS.map(check => check.id as string);

  it('has an explicit entry for every registered check and none for an unregistered one', () => {
    for (const id of ids) assert.ok(Object.hasOwn(RUN_CHECK_FIXES, id), `registered check ${id} has no Run dialog mapping`);
    assert.deepEqual(Object.keys(RUN_CHECK_FIXES).filter(id => !ids.includes(id)), []);
  });

  it('opens a real Settings section for every fixable check and never the Settings home', () => {
    const nav = buildSettingsNav();
    for (const id of ids) {
      const fix = runCheckFix(id);
      if (fix === null) continue;
      assert.notEqual(fix.section, '', `${id} would open the Settings home`);
      const resolved = resolveSettingsSection(nav, fix.section);
      assert.equal(resolved.state, 'open', `${id} maps to the unknown section ${fix.section}`);
      assert.ok(fix.label.length > 0);
    }
  });

  it('has readable copy for every registered check and refuses an unmapped id', () => {
    for (const id of ids) assert.ok(CHECK_COPY[id], `registered check ${id} has no readiness copy`);
    assert.throws(() => runCheckFix('new.check'), /no Settings mapping/u);
  });
});
