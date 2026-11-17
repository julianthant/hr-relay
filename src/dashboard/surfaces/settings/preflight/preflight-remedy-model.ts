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

/** Where a failed Run-dialog check can be fixed: a Settings section and the button's name, or null when the person cannot fix it there. */
export type RunCheckFix = Readonly<{ section: string; label: string }> | null;

const account = (label: string): RunCheckFix => ({ section: 'account', label });
const general = (label: string): RunCheckFix => ({ section: 'general', label });

/** Every registered check id has an explicit entry; a test fails when one is missing. */
export const RUN_CHECK_FIXES: Readonly<Record<string, RunCheckFix>> = Object.freeze({
  'runtime.compatibility': null,
  'browser.assets': null,
  'config.valid': general('Fix settings'),
  'filesystem.health': null,
  'authority.health': null,
  'ports.available': null,
  'fiscal.current': general('Set fiscal year'),
  'secrets.ucpath-sso': account('Add password'),
  'profile.identity': account('Set your name'),
  'secrets.sharepoint-roster': general('Set location'),
  'endpoint.ucpath.prod': general('Fix address'),
  'endpoint.crm.prod': general('Fix address'),
  'endpoint.onbase.prod': general('Fix address'),
  'endpoint.kuali.prod': general('Fix address'),
  'endpoint.servicenow.prod': general('Fix address'),
  'endpoint.i9.prod': general('Fix address'),
  'endpoint.new-kronos.prod': general('Fix address'),
  'endpoint.old-kronos.prod': general('Fix address'),
  'endpoint.sharepoint.prod': general('Fix address'),
  'provider.census': general('Fix provider'),
  'provider.nominatim': general('Fix provider'),
});

export function runCheckFix(check: string): RunCheckFix {
  const fix = RUN_CHECK_FIXES[check];
  if (fix === undefined) throw new Error(`Run check "${check}" has no Settings mapping`);
  return fix;
}
