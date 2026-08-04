import { declareDriverFor } from "../../base/store.js";
import type { KualiRrssDocumentDriver } from "../../domain/ui/kuali-rrss-document.js";

/** Task-safe declaration identity; raw browser ownership remains under `driver/`. */
export const kualiDriver = declareDriverFor<KualiRrssDocumentDriver>()("kuali", "semantic-ready");
