import { UiCatalogSchema } from "../../../domain/ui/contracts.js";
import type { UiCatalog, UiCatalogEntry } from "../../../domain/ui/contracts.js";
import { TaskIdSchema } from "../../../domain/ids.js";
import type { BrowserSystemId, TaskId } from "../../../domain/ids.js";
import { CRM_UI_REGISTRY } from "../../crm/driver/ui-registry.js";
import { KUALI_UI_REGISTRY } from "../../kuali/driver/ui-registry.js";
import { NEW_KRONOS_UI_REGISTRY } from "../../new-kronos/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "./ui-registry.js";

/** One generated artifact: its repo-relative path and its exact bytes. */
export interface UiCatalogProjection {
  readonly path: string;
  readonly content: string;
}

export const UI_CATALOG_JSON_PATH = "generated/ui-catalog.json";

const UCPATH_SOURCE_LINK = "src/stores/ucpath/driver/ui-registry.ts#UCPATH_UI_REGISTRY";
const CRM_SOURCE_LINK = "src/stores/crm/driver/ui-registry.ts#CRM_UI_REGISTRY";
const KUALI_SOURCE_LINK = "src/stores/kuali/driver/ui-registry.ts#KUALI_UI_REGISTRY";
const NEW_KRONOS_SOURCE_LINK = "src/stores/new-kronos/driver/ui-registry.ts#NEW_KRONOS_UI_REGISTRY";
const CRM_RECORD_TASK = TaskIdSchema.parse("crm/read-onboarding-record");
const CRM_DATES_TASK = TaskIdSchema.parse("crm/read-onboarding-dates");
/**
 * Kuali's write surface is used by the whole transaction pair plus both of its
 * reads. The Save button is deliberately attributed to the COMMIT task alone —
 * the catalog is what an operator reads to answer "what can click this?", and
 * naming the prepare task there would be a lie.
 */
const KUALI_PROBE_TASK = TaskIdSchema.parse("kuali/read-timekeeper-annotation");
const KUALI_VERIFY_TASK = TaskIdSchema.parse("kuali/verify-timekeeper-annotation");
const KUALI_FILL_TASK = TaskIdSchema.parse("kuali/fill-timekeeper-annotation");
const KUALI_SAVE_TASK = TaskIdSchema.parse("kuali/save-timekeeper-annotation");
const KUALI_ALL_TASKS = [KUALI_PROBE_TASK, KUALI_VERIFY_TASK, KUALI_FILL_TASK, KUALI_SAVE_TASK];
/**
 * New Kronos is read-only, and its two screens split cleanly by task: the search
 * panel belongs to the employee search, the timecard to the separation-timecard
 * read. Attribution is per SCREEN rather than per fact because nothing on the
 * search panel is reachable from the timecard read and vice versa.
 */
const NEW_KRONOS_SEARCH_TASK = TaskIdSchema.parse("new-kronos/search-employee");
const NEW_KRONOS_TIMECARD_TASK = TaskIdSchema.parse("new-kronos/read-separation-timecard");
const NEW_KRONOS_SEARCH_SCREEN_ID = "new-kronos.employee-search";

function newKronosTaskUses(screen: string): TaskId[] {
  return screen === NEW_KRONOS_SEARCH_SCREEN_ID ? [NEW_KRONOS_SEARCH_TASK] : [NEW_KRONOS_TIMECARD_TASK];
}

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
    ...KUALI_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      searchTerms: screen.searchTerms,
      sensitivity: screen.sensitivity,
      verification: safeVerification(screen.verification),
      taskUses: KUALI_ALL_TASKS,
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.elements.map((element) => ({
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
      taskUses: element.id === "kuali.rrss-document.save-button"
        ? [KUALI_SAVE_TASK]
        : element.id === "kuali.rrss-document.timekeeper-field"
          ? [KUALI_PROBE_TASK, KUALI_VERIFY_TASK, KUALI_FILL_TASK]
          : KUALI_ALL_TASKS,
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      screen: state.screen,
      label: state.label,
      searchTerms: state.searchTerms,
      sensitivity: state.sensitivity,
      verification: safeVerification(state.verification),
      taskUses: state.id === "kuali.rrss-document.timekeeper-staged"
        ? [KUALI_FILL_TASK, KUALI_SAVE_TASK]
        : KUALI_ALL_TASKS,
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      screen: observation.screen,
      label: observation.label,
      searchTerms: observation.searchTerms,
      sensitivity: observation.sensitivity,
      verification: safeVerification(observation.verification),
      taskUses: observation.id === "kuali.rrss-document.displayed-timekeeper"
        ? [KUALI_PROBE_TASK, KUALI_VERIFY_TASK, KUALI_FILL_TASK]
        : KUALI_ALL_TASKS,
      sourceLink: KUALI_SOURCE_LINK,
      authoritativeFor: observation.authoritativeFor,
    })),
    ...NEW_KRONOS_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      searchTerms: screen.searchTerms,
      sensitivity: screen.sensitivity,
      verification: safeVerification(screen.verification),
      taskUses: newKronosTaskUses(screen.id),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.elements.map((element) => ({
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
      taskUses: newKronosTaskUses(element.screen),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      screen: state.screen,
      label: state.label,
      searchTerms: state.searchTerms,
      sensitivity: state.sensitivity,
      verification: safeVerification(state.verification),
      taskUses: newKronosTaskUses(state.screen),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      screen: observation.screen,
      label: observation.label,
      searchTerms: observation.searchTerms,
      sensitivity: observation.sensitivity,
      verification: safeVerification(observation.verification),
      taskUses: newKronosTaskUses(observation.screen),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
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

/**
 * Every system that publishes semantic UI facts, DERIVED from the built catalog
 * rather than enumerated.
 *
 * The projection set used to be a hand-maintained list in three places (the
 * generator, the freshness guard, and the CLI fixture), and `kuali` reached only
 * the generator — so a stale `src/stores/kuali/UI-CATALOG.md` passed every gate.
 * A fourth store would have escaped the same way, so the list is gone: the
 * catalog's own entries decide which markdown files exist, and the guard proves
 * that set equals the set of stores that actually ship a `driver/ui-registry.ts`.
 */
export function uiCatalogSystems(catalog: UiCatalog): readonly BrowserSystemId[] {
  return [...new Set(catalog.entries.map((entry) => entry.system))].sort();
}

export function uiCatalogMarkdownPath(system: BrowserSystemId): string {
  return `src/stores/${system}/UI-CATALOG.md`;
}

/** The complete generated projection set: the JSON, plus one markdown per publishing system. */
export function uiCatalogProjections(catalog: UiCatalog): readonly UiCatalogProjection[] {
  return [
    { path: UI_CATALOG_JSON_PATH, content: `${JSON.stringify(catalog, null, 2)}\n` },
    ...uiCatalogSystems(catalog).map((system) => ({
      path: uiCatalogMarkdownPath(system),
      content: renderSystemUiCatalogMarkdown(catalog, system),
    })),
  ];
}

/**
 * The freshness arm, over an INJECTED reader so a negative control can hand it
 * stale or absent bytes for one exact projection. A missing projection is a
 * violation in its own right — an unwritten file must never read as fresh.
 */
export function auditUiCatalogProjections(
  catalog: UiCatalog,
  read: (path: string) => string | undefined,
): readonly string[] {
  const violations: string[] = [];
  for (const { path, content } of uiCatalogProjections(catalog)) {
    const current = read(path);
    if (current === undefined) {
      violations.push(`${path} is missing — run \`npm run ui:catalog\` and commit the result`);
      continue;
    }
    if (current !== content) {
      violations.push(`${path} is stale — run \`npm run ui:catalog\` and commit the result`);
    }
  }
  return violations;
}

export function renderSystemUiCatalogMarkdown(
  catalog: UiCatalog,
  system: BrowserSystemId,
): string {
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
