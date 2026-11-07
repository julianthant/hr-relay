import { declareDriverFor } from "../../../workflow-kit/task-registry.js";
import type { KualiRrssDocumentDriver } from "../../../models/ui/kuali-rrss-document.js";

/** Task-safe declaration identity; raw browser ownership remains under `driver/`. */
export const kualiDriver = declareDriverFor<KualiRrssDocumentDriver>()("kuali", "semantic-ready");
