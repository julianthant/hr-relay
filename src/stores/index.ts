import {
  EMPTY_TASK_CONTRACT_CORPUS,
  defineTaskStoreRegistry,
} from "../base/store.js";
import { crmStore } from "./crm/index.js";
import { i9Store } from "./i9/index.js";
import { kualiStore } from "./kuali/index.js";
import { newKronosStore } from "./new-kronos/index.js";
import { oldKronosStore } from "./old-kronos/index.js";
import { onbaseStore } from "./onbase/index.js";
import { servicenowStore } from "./servicenow/index.js";
import { sharepointStore } from "./sharepoint/index.js";
import { ucpathStore } from "./ucpath/index.js";

export const browserStoreRegistry = defineTaskStoreRegistry([
  ucpathStore,
  crmStore,
  onbaseStore,
  kualiStore,
  servicenowStore,
  i9Store,
  newKronosStore,
  oldKronosStore,
  sharepointStore,
], EMPTY_TASK_CONTRACT_CORPUS);
