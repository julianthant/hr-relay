import {
  defineTaskStoreRegistry,
} from "../../../workflow-kit/task-registry.js";
import type { RegisteredTaskStore } from "../../../workflow-kit/task-registry.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../../workflow-kit/validation/scenario-execution.js";
import { crmStore } from "../../systems/crm/task-registry.js";
import { extractionStore } from "../../processing/extraction/task-registry.js";
import { i9Store } from "../../systems/i9/task-registry.js";
import { kualiStore } from "../../systems/kuali/task-registry.js";
import { newKronosStore } from "../../systems/new-kronos/task-registry.js";
import { normalizationStore } from "../../processing/normalization/task-registry.js";
import { ocrStore } from "../../processing/ocr/task-registry.js";
import { oldKronosStore } from "../../systems/old-kronos/task-registry.js";
import { onbaseStore } from "../../systems/onbase/task-registry.js";
import { personLookupStore } from "../../../workflows/person-lookup/task-registry.js";
import { rosterStore } from "../../processing/roster/task-registry.js";
import { separationsStore } from "../../../workflows/separations/task-registry.js";
import { servicenowStore } from "../../systems/servicenow/task-registry.js";
import { sharepointStore } from "../../systems/sharepoint/task-registry.js";
import { ucpathStore } from "../../systems/ucpath/task-registry.js";

export const BROWSER_STORES = Object.freeze([
  ucpathStore,
  crmStore,
  onbaseStore,
  kualiStore,
  servicenowStore,
  i9Store,
  newKronosStore,
  oldKronosStore,
  sharepointStore,
]);

export const TASK_STORES: readonly RegisteredTaskStore[] = Object.freeze([
  ...BROWSER_STORES,
  extractionStore,
  normalizationStore,
  ocrStore,
  personLookupStore,
  rosterStore,
  separationsStore,
]);

function corpusFor(stores: readonly RegisteredTaskStore[]) {
  const tasks = stores.flatMap((store) => Object.values(store.tasks));
  return {
    scenarioIds: EXECUTABLE_SCENARIO_IDS,
    tasks: tasks.map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
  };
}

/** Browser-only declaration view consumed by the ref execution-and-sessions coverage guard. */
export const browserStoreRegistry = defineTaskStoreRegistry(BROWSER_STORES, corpusFor(BROWSER_STORES));

/** The executable task index: browser stores plus workflow/service mini-stores. */
export const taskStoreRegistry = defineTaskStoreRegistry(TASK_STORES, corpusFor(TASK_STORES));
