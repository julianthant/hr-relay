import { TaskIdSchema } from "../../rules/identity/ids.js";
import type { BrowserSystemId, TaskId } from "../../rules/identity/ids.js";
import { CRM_UI_REGISTRY } from "./crm/driver/ui-registry.js";
import { KUALI_UI_REGISTRY } from "./kuali/driver/ui-registry.js";
import { NEW_KRONOS_UI_REGISTRY } from "./new-kronos/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "./ucpath/driver/ui-registry.js";

export interface UiTaskLink {
  readonly kind: "screen" | "element" | "page-state" | "observation";
  readonly id: string;
  readonly system: BrowserSystemId;
  readonly label: string;
  readonly verification: { readonly verifiedAt: string };
  readonly taskUses: readonly TaskId[];
  readonly sourceLink: string;
}

const UCPATH_SOURCE_LINK = "src/backend/systems/ucpath/driver/ui-registry.ts#UCPATH_UI_REGISTRY";
const CRM_SOURCE_LINK = "src/backend/systems/crm/driver/ui-registry.ts#CRM_UI_REGISTRY";
const KUALI_SOURCE_LINK = "src/backend/systems/kuali/driver/ui-registry.ts#KUALI_UI_REGISTRY";
const NEW_KRONOS_SOURCE_LINK = "src/backend/systems/new-kronos/driver/ui-registry.ts#NEW_KRONOS_UI_REGISTRY";
const CRM_RESULTS_TASK = TaskIdSchema.parse("crm/read-onboarding-results");
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

const NEW_KRONOS_SEARCH_TASK = TaskIdSchema.parse("new-kronos/search-employee");
const NEW_KRONOS_TIMECARD_TASK = TaskIdSchema.parse("new-kronos/read-separation-timecard");
const NEW_KRONOS_SEARCH_SCREEN_ID = "new-kronos.employee-search";

function newKronosTaskUses(screen: string): TaskId[] {
  return screen === NEW_KRONOS_SEARCH_SCREEN_ID ? [NEW_KRONOS_SEARCH_TASK] : [NEW_KRONOS_TIMECARD_TASK];
}


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

function verifiedAt(verification: { readonly verifiedAt: string }): { readonly verifiedAt: string } {
  return { verifiedAt: verification.verifiedAt };
}

export function buildUiTaskLinks(): readonly UiTaskLink[] {
  const entries: UiTaskLink[] = [
    ...UCPATH_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      verification: verifiedAt(screen.verification),
      taskUses: ucpathTaskUses(screen.id, screen.id),
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...UCPATH_UI_REGISTRY.elements.map((element) => ({
      kind: "element" as const,
      id: element.id,
      system: element.system,
      label: element.label,
      verification: verifiedAt(element.verification),
      taskUses: ucpathTaskUses(element.id, element.screen),
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...UCPATH_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      label: state.label,
      verification: verifiedAt(state.verification),
      taskUses: ucpathTaskUses(state.id, state.screen),
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...UCPATH_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      label: observation.label,
      verification: verifiedAt(observation.verification),
      taskUses: ucpathTaskUses(observation.id, observation.screen),
      sourceLink: UCPATH_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      verification: verifiedAt(screen.verification),
      taskUses: screen.id === "crm.onboarding.history" ? [CRM_RECORD_TASK, CRM_DATES_TASK] : [CRM_RECORD_TASK, CRM_DATES_TASK, CRM_RESULTS_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.elements.map((element) => ({
      kind: "element" as const,
      id: element.id,
      system: element.system,
      label: element.label,
      verification: verifiedAt(element.verification),
      taskUses: element.id === "crm.onboarding.history-rows"
        ? [CRM_DATES_TASK]
        : [CRM_RECORD_TASK, CRM_DATES_TASK, CRM_RESULTS_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      label: state.label,
      verification: verifiedAt(state.verification),
      taskUses: state.id === "crm.onboarding.history-ready"
        ? [CRM_DATES_TASK]
        : [CRM_RECORD_TASK, CRM_DATES_TASK, CRM_RESULTS_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...CRM_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      label: observation.label,
      verification: verifiedAt(observation.verification),
      taskUses: [CRM_RECORD_TASK, CRM_DATES_TASK, CRM_RESULTS_TASK],
      sourceLink: CRM_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      verification: verifiedAt(screen.verification),
      taskUses: kualiTaskUses(screen.id),
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.elements.map((element) => ({
      kind: "element" as const,
      id: element.id,
      system: element.system,
      label: element.label,
      verification: verifiedAt(element.verification),
      taskUses: kualiTaskUses(element.id),
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      label: state.label,
      verification: verifiedAt(state.verification),
      taskUses: kualiTaskUses(state.id),
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...KUALI_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      label: observation.label,
      verification: verifiedAt(observation.verification),
      taskUses: kualiTaskUses(observation.id),
      sourceLink: KUALI_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.screens.map((screen) => ({
      kind: "screen" as const,
      id: screen.id,
      system: screen.system,
      label: screen.label,
      verification: verifiedAt(screen.verification),
      taskUses: newKronosTaskUses(screen.id),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.elements.map((element) => ({
      kind: "element" as const,
      id: element.id,
      system: element.system,
      label: element.label,
      verification: verifiedAt(element.verification),
      taskUses: newKronosTaskUses(element.screen),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.states.map((state) => ({
      kind: "page-state" as const,
      id: state.id,
      system: state.system,
      label: state.label,
      verification: verifiedAt(state.verification),
      taskUses: newKronosTaskUses(state.screen),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
    ...NEW_KRONOS_UI_REGISTRY.observations.map((observation) => ({
      kind: "observation" as const,
      id: observation.id,
      system: observation.system,
      label: observation.label,
      verification: verifiedAt(observation.verification),
      taskUses: newKronosTaskUses(observation.screen),
      sourceLink: NEW_KRONOS_SOURCE_LINK,
    })),
  ];
  return entries;
}
