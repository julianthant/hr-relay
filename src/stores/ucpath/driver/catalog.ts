import { UiCatalogSchema } from "../../../domain/ui/contracts.js";
import type { UiCatalog, UiCatalogEntry } from "../../../domain/ui/contracts.js";
import { TaskIdSchema } from "../../../domain/ids.js";
import { CRM_UI_REGISTRY } from "../../crm/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "./ui-registry.js";

const UCPATH_SOURCE_LINK = "src/stores/ucpath/driver/ui-registry.ts#UCPATH_UI_REGISTRY";
const CRM_SOURCE_LINK = "src/stores/crm/driver/ui-registry.ts#CRM_UI_REGISTRY";
const CRM_RECORD_TASK = TaskIdSchema.parse("crm/read-onboarding-record");
const CRM_DATES_TASK = TaskIdSchema.parse("crm/read-onboarding-dates");

function safeVerification(verification: (typeof UCPATH_UI_REGISTRY.screens)[number]["verification"]) {
  return {
    verifiedAt: verification.verifiedAt,
    fixtureEvidenceRef: verification.fixtureEvidenceRef,
    liveReadOnlyEvidenceRef: verification.liveReadOnlyEvidenceRef,
    scenarios: verification.scenarios,
  };
}

export function buildSafeUiCatalog(): UiCatalog {
  const taskUses: never[] = [];
  const entries: UiCatalogEntry[] = [
    ...UCPATH_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      searchTerms: screen.searchTerms,
      sensitivity: screen.sensitivity,
      verification: safeVerification(screen.verification),
      taskUses,
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...UCPATH_UI_REGISTRY.elements.map((element) => ({
      kind: "element" as const,
      id: element.id,
      system: element.system,
      screen: element.screen,
      label: element.label,
      searchTerms: element.searchTerms,
      role: element.role,
      effect: element.effect,
      sensitivity: element.sensitivity,
      verification: safeVerification(element.verification),
      taskUses,
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...UCPATH_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      screen: state.screen,
      label: state.label,
      searchTerms: state.searchTerms,
      sensitivity: state.sensitivity,
      verification: safeVerification(state.verification),
      taskUses,
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...UCPATH_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      screen: observation.screen,
      label: observation.label,
      searchTerms: observation.searchTerms,
      sensitivity: observation.sensitivity,
      verification: safeVerification(observation.verification),
      taskUses,
      sourceLink: UCPATH_SOURCE_LINK,
      authoritativeFor: observation.authoritativeFor,
    })),
    ...CRM_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      searchTerms: screen.searchTerms,
      sensitivity: screen.sensitivity,
      verification: safeVerification(screen.verification),
      taskUses: [CRM_RECORD_TASK, CRM_DATES_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.elements.map((element) => ({
      kind: "element" as const,
      id: element.id,
      system: element.system,
      screen: element.screen,
      label: element.label,
      searchTerms: element.searchTerms,
      role: element.role,
      effect: element.effect,
      sensitivity: element.sensitivity,
      verification: safeVerification(element.verification),
      taskUses: element.id === "crm.onboarding.history-rows"
        ? [CRM_DATES_TASK]
        : [CRM_RECORD_TASK, CRM_DATES_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      screen: state.screen,
      label: state.label,
      searchTerms: state.searchTerms,
      sensitivity: state.sensitivity,
      verification: safeVerification(state.verification),
      taskUses: state.id === "crm.onboarding.history-ready"
        ? [CRM_DATES_TASK]
        : [CRM_RECORD_TASK, CRM_DATES_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      screen: observation.screen,
      label: observation.label,
      searchTerms: observation.searchTerms,
      sensitivity: observation.sensitivity,
      verification: safeVerification(observation.verification),
      taskUses: [CRM_RECORD_TASK, CRM_DATES_TASK],
      sourceLink: CRM_SOURCE_LINK,
      authoritativeFor: observation.authoritativeFor,
    })),
  ];
  return UiCatalogSchema.parse({ schemaVersion: 1, entries });
}

export function assertSafeUiCatalogFresh(input: unknown): UiCatalog {
  const generated = UiCatalogSchema.parse(input);
  const current = buildSafeUiCatalog();
  if (JSON.stringify(generated) !== JSON.stringify(current)) {
    throw new Error("generated UI catalog is stale; run npm run ui:catalog");
  }
  return generated;
}

export function renderSystemUiCatalogMarkdown(catalog: UiCatalog, system: "ucpath" | "crm"): string {
  const entries = catalog.entries.filter((entry) => entry.system === system);
  const lines = [
    `# ${system} — Semantic UI Catalog`,
    "",
    "_Generated by `npm run ui:catalog`. Recipes and captured values are server-private and omitted._",
    "",
    `**${String(entries.length)} semantic facts**`,
    "",
  ];
  for (const entry of entries) {
    lines.push(`## \`${entry.id}\` — ${entry.label}`, "");
    lines.push(`- Kind: ${entry.kind}`);
    lines.push(`- Search terms: ${entry.searchTerms.join(", ")}`);
    lines.push(`- Verified: ${entry.verification.verifiedAt}`);
    lines.push(`- Fixture evidence: \`${entry.verification.fixtureEvidenceRef}\``);
    lines.push(`- Live read-only evidence: \`${entry.verification.liveReadOnlyEvidenceRef}\``);
    lines.push(`- Source: \`${entry.sourceLink}\``, "");
  }
  return lines.join("\n");
}
