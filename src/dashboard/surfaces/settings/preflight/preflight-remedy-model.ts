export type PreflightRemedy = 'settings' | 'storage' | 'sessions' | 'credentials' | 'routes';

/** Destinations available in both the compact report and the Settings page. */
export function preflightRemedy(check: string): PreflightRemedy {
  switch (check) {
    case 'authority.health':
    case 'filesystem.health': return 'storage';
    case 'secrets.ucpath-sso':
    case 'secrets.timekeeper': return 'credentials';
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
