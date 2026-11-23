import type { EditorValue } from "../../../../models/dashboard/settings-editor.js";

export const PROFILE_WORKFLOW_FACTS = [
  { key: "displayName", label: "Timekeeper name", target: "profile.displayName" },
  { key: "initials", label: "Timekeeper initials", target: "profile.initials" },
] as const;

const PROVIDER_FIELDS: Readonly<Record<string, { readonly label: string; readonly unit?: string }>> = Object.freeze({
  timeoutMs: { label: "Request timeout", unit: "milliseconds" },
  concurrency: { label: "Parallel requests" },
  requestsPerMinute: { label: "Requests per minute" },
  dailyRequestLimit: { label: "Daily request limit" },
  costLimitUsdMicros: { label: "Daily cost ceiling", unit: "USD micro-units" },
});

function words(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./u, character => character.toLocaleUpperCase());
}

export function providerFieldPresentation(key: string): { readonly label: string; readonly unit?: string } {
  return PROVIDER_FIELDS[key] ?? { label: words(key) };
}

export function settingsFactLabel(key: string): string {
  const labels: Readonly<Record<string, string>> = {
    "actor.id": "Local operator ID",
    "urls.kuali.prod": "Kuali production routes",
    "urls.newKronos.prod": "New Kronos production routes",
    "urls.crm.prod": "CRM production routes",
    "urls.onbase.prod": "OnBase production routes",
    "urls.ucpath.prod": "UCPath production routes",
    "urls.i9.prod": "I-9 production routes",
    "urls.oldKronos.prod": "Old Kronos production routes",
    "urls.servicenow.prod": "ServiceNow production routes",
    "urls.sharepoint.prod": "SharePoint production routes",
    "paths.stateRoot": "Runtime state folder",
    "paths.artifactRoot": "Artifact folder",
    "paths.browserProfileRoot": "Browser profile folder",
    "paths.duoCredential": "Duo credential file",
    "paths.duoExtensionDir": "Duo extension folder",
    duoWebauthnCredential: "Duo WebAuthn credential file",
    entry: "Entry URL",
    login: "Login URL",
    onboardingSearch: "Onboarding search URL",
    ucPathEntrySheet: "UCPath entry sheet URL",
    onboardingHistory: "Onboarding history URL",
    idocsViewer: "iDocs viewer URL",
    smartHr: "SmartHR URL",
    jobSummary: "Job summary URL",
    personalData: "Personal data URL",
    personProfile: "Person profile URL",
    app: "Application URL",
  };
  return labels[key] ?? words(key);
}

export interface SettingsFactGroup {
  readonly label: string;
  readonly entries: readonly { readonly key: string; readonly value: EditorValue }[];
}

export function groupDeploymentFacts(facts: Readonly<Record<string, EditorValue>>): readonly SettingsFactGroup[] {
  const groups = new Map<string, { key: string; value: EditorValue }[]>();
  for (const [key, value] of Object.entries(facts)) {
    const label = key === "actor.id" ? "Operator" : key.startsWith("urls.") ? "Production routes" : key.startsWith("paths.") || key === "duoWebauthnCredential" ? "Local paths" : "Deployment details";
    const entries = groups.get(label) ?? [];
    entries.push({ key, value });
    groups.set(label, entries);
  }
  return [...groups].map(([label, entries]) => ({ label, entries }));
}
