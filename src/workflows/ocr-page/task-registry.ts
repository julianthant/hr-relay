import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readOcrPageReadingTask } from "./tasks/read-page-reading.js";

import { readManualOcrReadingTask } from "./tasks/read-manual-reading.js";

export const ocrPageStore = defineWorkflowStore("ocr-page", { bindReading: readOcrPageReadingTask, readManualReading: readManualOcrReadingTask });
