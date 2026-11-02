import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { prepareOcrPagesTask } from "./tasks/prepare-pages.js";
import { buildOcrReviewSeedTask } from "./tasks/build-review-seed.js";

export const ocrWorkflowStore = defineWorkflowStore("ocr", { preparePages: prepareOcrPagesTask, buildReviewSeed: buildOcrReviewSeedTask });
