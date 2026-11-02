import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readOcrSourcePagesTask } from "./tasks/read-source-pages.js";
import { readOcrReviewSeedTask } from "./tasks/read-review-seed.js";

export const ocrWorkflowStore = defineWorkflowStore("ocr", { preparePages: readOcrSourcePagesTask, buildReviewSeed: readOcrReviewSeedTask });
