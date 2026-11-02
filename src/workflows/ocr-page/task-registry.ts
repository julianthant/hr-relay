import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { bindOcrReadingTask } from "./tasks/bind-reading.js";

import { readManualOcrReadingTask } from "./tasks/read-manual-reading.js";

export const ocrPageStore = defineWorkflowStore("ocr-page", { bindReading: bindOcrReadingTask, readManualReading: readManualOcrReadingTask });
