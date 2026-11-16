import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readOcrSourcePagesTask } from "./tasks/read-source-pages.js";
import { readOcrReviewSeedTask } from "./tasks/read-review-seed.js";
import { readOcrResultTask } from "./tasks/read-result.js";

export const ocrWorkflowStore = defineWorkflowStore("ocr", { readSourcePages: readOcrSourcePagesTask, readReviewSeed: readOcrReviewSeedTask, readResult: readOcrResultTask });
