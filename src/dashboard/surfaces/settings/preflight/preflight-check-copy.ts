export const CHECK_COPY: Record<string, { name: string; description: string }> = {
  "runtime.compatibility": { name: "Runtime compatibility", description: "Checks Node.js and installed dependencies for this release." },
  "browser.assets": { name: "Browser tools", description: "Checks the required browser and extension files." },
  "config.valid": { name: "Runtime settings", description: "Checks current configuration validity." },
  "filesystem.health": { name: "Files and disk space", description: "Checks required directories and free space." },
  "authority.health": { name: "Data store readiness", description: "Checks the data store and run records for this scope." },
  "ports.available": { name: "Network ports", description: "Checks the dashboard's reserved ports." },
  "fiscal.current": { name: "Current fiscal year", description: "Checks the workflow's fiscal year configuration." },
  "secrets.ucpath-sso": { name: "UCPath sign-in", description: "Checks the username and password required for UCPath sign-in." },
  "secrets.sharepoint-roster": { name: "SharePoint roster", description: "Checks the onboarding roster location used by this workflow." },
};
