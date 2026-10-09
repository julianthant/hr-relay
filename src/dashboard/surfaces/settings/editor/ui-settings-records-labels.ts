import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import type { EditableSettingsLeafWire } from "../../../../models/dashboard/settings-editor.js";
import type { EditorValue } from "../../../../models/dashboard/settings-editor.js";

const PROVIDER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  geocodeCensus: "Census geocoding",
  geocodeNominatim: "Nominatim geocoding",
});

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

export function providerName(key: string): string {
  return PROVIDER_NAMES[key] ?? words(key);
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

export interface SettingsLeafGroup {
  readonly label: string;
  readonly leaves: readonly EditableSettingsLeafWire[];
}

export interface SettingsValueGroup {
  readonly label: string;
  readonly value: EditableSettingsLeafWire["effectiveValue"];
}

export function settingsValueGroups(leaf: EditableSettingsLeafWire): readonly SettingsValueGroup[] {
  const sources = [
    ...(leaf.settingsValue === undefined ? [] : [{ label: "Saved", value: leaf.settingsValue }]),
    { label: "Active", value: leaf.activeValue },
    { label: "Default", value: leaf.defaultValue },
  ];
  const groups = new Map<string, { label: string; value: SettingsValueGroup["value"] }>();
  for (const source of sources) {
    const key = source.value === undefined ? "not-set" : canonicalJsonStringify(source.value);
    const group = groups.get(key);
    groups.set(key, group === undefined
      ? { label: source.label, value: source.value }
      : { ...group, label: `${group.label} and ${source.label}` });
  }
  return [...groups.values()];
}

export function differingSettingsValues(leaf: EditableSettingsLeafWire): readonly SettingsValueGroup[] {
  const groups = settingsValueGroups(leaf);
  return groups.length > 1 ? groups : [];
}

function groupLabel(sectionId: string, path: string): string {
  const parts = path.split(".");
  if (sectionId === "annual-dates") return "Job end date";
  if (sectionId === "providers") return providerName(parts[1] ?? "Provider");
  if (sectionId === "display") return "Primary display";
  if (sectionId === "general") return "Operator";
  if (sectionId === "routes") return "System destinations";
  if (sectionId === "performance") return parts[0] === "daemon" ? "Worker sessions" : "Run capacity";
  if (sectionId === "paths") {
    const stem = parts[1] ?? "paths";
    if (/^(?:browser|duo)/iu.test(stem)) return "Browser sessions";
    if (/^(?:state|artifact)/iu.test(stem)) return "Runtime storage";
    return "Reports and documents";
  }
  return words(parts[0] ?? sectionId);
}

export function groupSettingsLeaves(sectionId: string, leaves: readonly EditableSettingsLeafWire[]): readonly SettingsLeafGroup[] {
  const groups = new Map<string, EditableSettingsLeafWire[]>();
  for (const leaf of leaves) {
    const label = groupLabel(sectionId, leaf.path);
    const group = groups.get(label) ?? [];
    group.push(leaf);
    groups.set(label, group);
  }
  return [...groups].map(([label, groupedLeaves]) => ({ label, leaves: groupedLeaves }));
}
