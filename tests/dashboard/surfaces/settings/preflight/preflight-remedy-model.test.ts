import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { CURRENT_FISCAL_TARGET,preflightRemedy,preflightRemedyLabel,RUN_CHECK_FIXES,RUN_CHECK_HINTS,runCheckFix,runCheckForTarget,runCheckHint } from '../../../../../src/dashboard/surfaces/settings/preflight/preflight-remedy-model.js';
import { CHECK_COPY } from '../../../../../src/dashboard/surfaces/settings/preflight/preflight-check-copy.js';
import { buildSettingsNav,resolveSettingsSection } from '../../../../../src/dashboard/surfaces/settings/settings-model.js';
import { settingsSearchIndex } from '../../../../../src/dashboard/surfaces/settings/navigation/settings-search-model.js';
import { fixtureSettingsDocument } from '../../../../mocks/helpers/fixture-settings.js';
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

  it('lands every Fix on a row that changes that check, found in the Settings index of its section', () => {
    const document = fixtureSettingsDocument();
    const nav = buildSettingsNav(document);
    const index = settingsSearchIndex(nav, document);
    const labels = new Set<string>();
    for (const id of ids) {
      const fix = runCheckFix(id);
      if (fix === null) continue;
      assert.ok(fix.target !== undefined, `${id} has a Fix but no row to land on`);
      const target = fix.target === CURRENT_FISCAL_TARGET ? `annualDates.FY${String(document.currentFiscalYear)}.jobEndDate` : fix.target;
      const section = resolveSettingsSection(nav, fix.section);
      assert.ok(section.state === 'open' && index.some(result => result.entry.id === section.entry.id && result.target === target), `${id} lands on ${target}, which ${fix.section} does not offer`);
      assert.equal(runCheckForTarget(fix.target), id);
      assert.ok(!labels.has(fix.label), `two Fix buttons are both named ${fix.label}`);
      labels.add(fix.label);
    }
  });

  it('has readiness copy for every check a Fix can open Settings for, so the Settings banner can name it', () => {
    for (const id of ids) if (runCheckFix(id) !== null) assert.ok(CHECK_COPY[id]?.name, `${id} has a Fix but no readiness copy`);
  });

  it('gives every check without a Fix a plain hint, and none to a check that has one', () => {
    for (const id of ids) {
      if (runCheckFix(id) === null) assert.match(runCheckHint(id), /^Cannot be fixed in Settings\. /u, id);
      else assert.ok(!Object.hasOwn(RUN_CHECK_HINTS, id), `${id} has a Fix and a hint`);
    }
    assert.throws(() => runCheckHint('new.check'), /no cannot-fix-here hint/u);
    assert.equal(runCheckForTarget(undefined), undefined);
  });

  it('has readable copy for every registered check and refuses an unmapped id', () => {
    for (const id of ids) assert.ok(CHECK_COPY[id], `registered check ${id} has no readiness copy`);
    assert.throws(() => runCheckFix('new.check'), /no Settings mapping/u);
  });
});
