import {
  defineTaskStoreRegistry,
} from "../../base/store.js";
import type { RegisteredTaskStore } from "../../base/store.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../domain/workflow/scenario-execution.js";
import { crmStore } from "../../stores/crm/index.js";
import { extractionStore } from "../../stores/extraction/index.js";
import { i9Store } from "../../stores/i9/index.js";
import { kualiStore } from "../../stores/kuali/index.js";
import { newKronosStore } from "../../stores/new-kronos/index.js";
import { normalizationStore } from "../../stores/normalization/index.js";
import { ocrStore } from "../../stores/ocr/index.js";
import { oldKronosStore } from "../../stores/old-kronos/index.js";
import { onbaseStore } from "../../stores/onbase/index.js";
import { personLookupStore } from "../../stores/person-lookup/index.js";
import { rosterStore } from "../../stores/roster/index.js";
import { separationsStore } from "../../stores/separations/index.js";
import { servicenowStore } from "../../stores/servicenow/index.js";
import { sharepointStore } from "../../stores/sharepoint/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";

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
