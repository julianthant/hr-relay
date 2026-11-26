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

/** Where a failed Run-dialog check can be fixed: the Settings page, the row on it that changes the value, and the button's name; null when no Settings control changes it. */
export type RunCheckFix = Readonly<{ section: string; label: string; target?: string }> | null;

/** Stands for the current fiscal year's job end date row, whose path carries the year; Settings resolves it from the served document. */
export const CURRENT_FISCAL_TARGET = 'annualDates.current';
export const DUO_SECURITY_TARGET = 'security.duo';

const at = (section: string, label: string, target: string): RunCheckFix => ({ section, label, target });

/** Every registered check id has an explicit entry; a test fails when one is missing. */
export const RUN_CHECK_FIXES: Readonly<Record<string, RunCheckFix>> = Object.freeze({
  'runtime.compatibility': null,
  'browser.assets': null,
  'browser.duo-key': at('account', 'Fix', DUO_SECURITY_TARGET),
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

export function runCheckFix(check: string): RunCheckFix {
  const fix = RUN_CHECK_FIXES[check];
  if (fix === undefined) throw new Error(`Run check "${check}" has no Settings mapping`);
  return fix;
}

/** The check a Settings row was opened for, or undefined when no Fix button targets that row. */
export function runCheckForTarget(target: string | undefined): string | undefined {
  return Object.entries(RUN_CHECK_FIXES).find(([, fix]) => fix !== null && fix.target === target)?.[0];
}
