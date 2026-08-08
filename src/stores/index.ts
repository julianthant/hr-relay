import {
  defineTaskStoreRegistry,
} from "../base/store.js";
import type { RegisteredTaskStore } from "../base/store.js";
import { EXECUTABLE_SCENARIO_IDS } from "../domain/workflow/scenario-execution.js";
import { crmStore } from "./crm/index.js";
import { extractionStore } from "./extraction/index.js";
import { i9Store } from "./i9/index.js";
import { kualiStore } from "./kuali/index.js";
import { newKronosStore } from "./new-kronos/index.js";
import { ocrStore } from "./ocr/index.js";
import { oldKronosStore } from "./old-kronos/index.js";
import { onbaseStore } from "./onbase/index.js";
import { personLookupStore } from "./person-lookup/index.js";
import { rosterStore } from "./roster/index.js";
import { servicenowStore } from "./servicenow/index.js";
import { sharepointStore } from "./sharepoint/index.js";
import { ucpathStore } from "./ucpath/index.js";

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
  ocrStore,
  personLookupStore,
  rosterStore,
]);

function corpusFor(stores: readonly RegisteredTaskStore[]) {
  const tasks = stores.flatMap((store) => Object.values(store.tasks));
  return {
    scenarioIds: EXECUTABLE_SCENARIO_IDS,
    tasks: tasks.map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
  };
}

/** Browser-only declaration view consumed by the doc-05 coverage guard. */
export const browserStoreRegistry = defineTaskStoreRegistry(BROWSER_STORES, corpusFor(BROWSER_STORES));

/** The executable task index: browser stores plus workflow/service mini-stores. */
export const taskStoreRegistry = defineTaskStoreRegistry(TASK_STORES, corpusFor(TASK_STORES));
