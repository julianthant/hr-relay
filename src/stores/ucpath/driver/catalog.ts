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
const KUALI_SEARCH_TASK = TaskIdSchema.parse("kuali/search-separation-action");
const KUALI_READ_TASK = TaskIdSchema.parse("kuali/read-separation-document");
const KUALI_MATCH_FINALIZATION_TASK = TaskIdSchema.parse("kuali/match-separation-finalization");
const KUALI_STAGE_FINALIZATION_TASK = TaskIdSchema.parse("kuali/stage-separation-finalization");
const KUALI_SAVE_FINALIZATION_TASK = TaskIdSchema.parse("kuali/save-separation-finalization");
const KUALI_VERIFY_FINALIZATION_TASK = TaskIdSchema.parse("kuali/verify-separation-finalization");

const KUALI_DOCUMENT_READERS = [
  KUALI_READ_TASK,
  KUALI_MATCH_FINALIZATION_TASK,
  KUALI_STAGE_FINALIZATION_TASK,
  KUALI_VERIFY_FINALIZATION_TASK,
];
/**
 * Kuali attribution splits by FACT. The separation reader and finalization
 * probe/stage/verifier share one RRSS document; the Action List belongs only to
 * the search task; and Save belongs only to the commit task because naming a
 * prepare or verifier beside it would lie about which task can click.
 */
const KUALI_READ_ONLY_FACTS: readonly string[] = [
  "kuali.rrss-document.employee-name-field",
  "kuali.rrss-document.termination-type-field",
  "kuali.rrss-document.location-field",
  "kuali.rrss-document.separation-ready",
  "kuali.rrss-document.displayed-number",
  "kuali.rrss-document.displayed-form-type",
];

function kualiTaskUses(id: string): TaskId[] {
  if (KUALI_READ_ONLY_FACTS.includes(id)) return [KUALI_READ_TASK];
  if (id.startsWith("kuali.action-list")) return [KUALI_SEARCH_TASK];
  if (id === "kuali.rrss-document") {
    return [...KUALI_DOCUMENT_READERS, KUALI_SAVE_FINALIZATION_TASK];
  }
  if (id === "kuali.rrss-document.save-button") return [KUALI_SAVE_FINALIZATION_TASK];
  if (id === "kuali.rrss-document.finalization-staged") {
    return [KUALI_STAGE_FINALIZATION_TASK, KUALI_SAVE_FINALIZATION_TASK];
  }
  if (id === "kuali.rrss-document.displayed-transaction-number") {
    return [KUALI_MATCH_FINALIZATION_TASK, KUALI_VERIFY_FINALIZATION_TASK];
  }
  return [...KUALI_DOCUMENT_READERS];
}
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

/**
 * UCPath's attribution splits by SCREEN FAMILY, and within the termination
 * family by FACT — the same rule Kuali settled (D197 #2), because the catalog
 * is what an operator reads to answer "what can click this?".
 *
 * The two commit controls are attributed to their COMMIT task alone. Naming the
 * prepare task beside `Save and Submit` would be a lie about which task can
 * file a real termination, and naming anything but the sweep's commit beside
 * `Delete Selected Transactions` would be a lie about which task can delete.
 *
 * The Person Org family stays unattributed: its two read tasks reach the page
 * through one semantic driver operation each, and the registry's Person Org
 * elements are the driver's internal steps rather than task-addressable facts.
 */
const UCPATH_STAGE_TERMINATION_TASK = TaskIdSchema.parse("ucpath/stage-termination");
const UCPATH_CREATE_TERMINATION_TASK = TaskIdSchema.parse("ucpath/create-termination");
const UCPATH_STAGE_SWEEP_TASK = TaskIdSchema.parse("ucpath/stage-pending-termination-sweep");
const UCPATH_DELETE_PENDING_TASK = TaskIdSchema.parse("ucpath/delete-pending-terminations");
const UCPATH_MATCH_EXISTING_TASK = TaskIdSchema.parse("ucpath/match-existing-termination");
const UCPATH_MATCH_PENDING_TASK = TaskIdSchema.parse("ucpath/match-pending-terminations");
const UCPATH_VERIFY_TERMINATION_TASK = TaskIdSchema.parse("ucpath/verify-termination");
const UCPATH_VERIFY_SWEEP_TASK = TaskIdSchema.parse("ucpath/verify-pending-terminations-cleared");

/** Every task that reads the SS Smart HR transaction surface. */
const UCPATH_SS_SMART_HR_READERS = [
  UCPATH_MATCH_EXISTING_TASK,
  UCPATH_MATCH_PENDING_TASK,
  UCPATH_VERIFY_TERMINATION_TASK,
  UCPATH_VERIFY_SWEEP_TASK,
];

function ucpathTaskUses(id: string, screen: string | undefined): TaskId[] {
  if (id === "ucpath.smart-hr.save-and-submit-button") return [UCPATH_CREATE_TERMINATION_TASK];
  if (id === "ucpath.smart-hr.delete-selected-button") return [UCPATH_DELETE_PENDING_TASK];
  if (id === "ucpath.smart-hr.setup" || screen === "ucpath.smart-hr.setup") {
    // The setup page carries BOTH the wizard's entry and the in-progress grid
    // the sweep selects from, so both prepares reach it.
    return [UCPATH_STAGE_TERMINATION_TASK, UCPATH_STAGE_SWEEP_TASK];
  }
  if (id.startsWith("ucpath.smart-hr.") || screen?.startsWith("ucpath.smart-hr.") === true) {
    return [UCPATH_STAGE_TERMINATION_TASK];
  }
  if (id === "ucpath.ss-smart-hr.search" || screen === "ucpath.ss-smart-hr.search") {
    return [...UCPATH_SS_SMART_HR_READERS];
  }
  return [];
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
  const entries: UiCatalogEntry[] = [
    ...UCPATH_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      searchTerms: screen.searchTerms,
      sensitivity: screen.sensitivity,
      verification: safeVerification(screen.verification),
      taskUses: ucpathTaskUses(screen.id, screen.id),
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
      taskUses: ucpathTaskUses(element.id, element.screen),
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
      taskUses: ucpathTaskUses(state.id, state.screen),
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
      taskUses: ucpathTaskUses(observation.id, observation.screen),
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
      taskUses: kualiTaskUses(screen.id),
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
      taskUses: kualiTaskUses(element.id),
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
      taskUses: kualiTaskUses(state.id),
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
      taskUses: kualiTaskUses(observation.id),
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
