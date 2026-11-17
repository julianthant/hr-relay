export type PreflightRemedy = 'settings' | 'storage' | 'sessions' | 'credentials' | 'routes';

/** Destinations available in both the compact report and the Settings page. */
export function preflightRemedy(check: string): PreflightRemedy {
  switch (check) {
    case 'authority.health':
    case 'filesystem.health': return 'storage';
    case 'secrets.ucpath-sso': return 'credentials';
    case 'secrets.sharepoint-roster': return 'routes';
    default: return 'settings';
  }
}

export function preflightRemedyLabel(remedy: PreflightRemedy): string {
  switch (remedy) {
    case 'sessions': return 'Open Sessions';
    case 'storage': return 'Open Storage';
    case 'credentials': return 'Configure credentials';
    case 'routes': return 'Configure SharePoint route';
    case 'settings': return 'Open Settings';
  }
}

/** Where a failed Run-dialog check can be fixed: the Settings page, the row on it that changes the value, and the button's name; null when no Settings control changes it. */
export type RunCheckFix = Readonly<{ section: string; label: string; target?: string }> | null;

/** Stands for the current fiscal year's job end date row, whose path carries the year; Settings resolves it from the served document. */
export const CURRENT_FISCAL_TARGET = 'annualDates.current';

const at = (section: string, label: string, target: string): RunCheckFix => ({ section, label, target });

const NO_ADDRESS_CONTROL = 'Cannot be fixed in Settings. Restart Relay, then check again.';
const NO_PROVIDER_CONTROL = 'Cannot be fixed in Settings. Restart Relay, then check again.';

/** Every registered check id has an explicit entry; a test fails when one is missing. */
export const RUN_CHECK_FIXES: Readonly<Record<string, RunCheckFix>> = Object.freeze({
  'runtime.compatibility': null,
  'browser.assets': null,
  'config.valid': null,
  'filesystem.health': null,
  'authority.health': null,
  'ports.available': null,
  'fiscal.current': at('general', 'Set fiscal year', CURRENT_FISCAL_TARGET),
  'secrets.ucpath-sso': at('account', 'Add password', 'protected.ucpathPassword'),
  'profile.identity': at('account', 'Set timekeeper name', 'profile.displayName'),
  'secrets.sharepoint-roster': null,
  'endpoint.ucpath.prod': null,
  'endpoint.crm.prod': null,
  'endpoint.onbase.prod': null,
  'endpoint.kuali.prod': null,
  'endpoint.servicenow.prod': null,
  'endpoint.i9.prod': null,
  'endpoint.new-kronos.prod': null,
  'endpoint.old-kronos.prod': null,
  'endpoint.sharepoint.prod': null,
  'provider.census': null,
  'provider.nominatim': null,
});

/** What to do about a failed check that has no Fix button; every null entry above has one. */
export const RUN_CHECK_HINTS: Readonly<Record<string, string>> = Object.freeze({
  'runtime.compatibility': 'Cannot be fixed in Settings. Reinstall Relay or update Node.js.',
  'browser.assets': 'Cannot be fixed in Settings. Reinstall Relay to restore its browser files.',
  'config.valid': 'Cannot be fixed in Settings. Restart Relay, then check again.',
  'filesystem.health': 'Cannot be fixed in Settings. Free up disk space, then check again.',
  'authority.health': 'Cannot be fixed in Settings. Restart Relay, then check again.',
  'ports.available': 'Cannot be fixed in Settings. Close the program using the port.',
  'secrets.sharepoint-roster': 'Cannot be fixed in Settings. Restart Relay, then check again.',
  'endpoint.ucpath.prod': NO_ADDRESS_CONTROL,
  'endpoint.crm.prod': NO_ADDRESS_CONTROL,
  'endpoint.onbase.prod': NO_ADDRESS_CONTROL,
  'endpoint.kuali.prod': NO_ADDRESS_CONTROL,
  'endpoint.servicenow.prod': NO_ADDRESS_CONTROL,
  'endpoint.i9.prod': NO_ADDRESS_CONTROL,
  'endpoint.new-kronos.prod': NO_ADDRESS_CONTROL,
  'endpoint.old-kronos.prod': NO_ADDRESS_CONTROL,
  'endpoint.sharepoint.prod': NO_ADDRESS_CONTROL,
  'provider.census': NO_PROVIDER_CONTROL,
  'provider.nominatim': NO_PROVIDER_CONTROL,
});

export function runCheckFix(check: string): RunCheckFix {
  const fix = RUN_CHECK_FIXES[check];
  if (fix === undefined) throw new Error(`Run check "${check}" has no Settings mapping`);
  return fix;
}

export function runCheckHint(check: string): string {
  const hint = RUN_CHECK_HINTS[check];
  if (hint === undefined) throw new Error(`Run check "${check}" has no cannot-fix-here hint`);
  return hint;
}

/** The check a Settings row was opened for, or undefined when no Fix button targets that row. */
export function runCheckForTarget(target: string | undefined): string | undefined {
  return Object.entries(RUN_CHECK_FIXES).find(([, fix]) => fix !== null && fix.target === target)?.[0];
}
