import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { Notice } from "../../../ds/ui.js";
import type { StorageHealthSummary } from "./storage-settings-model.js";

const AUTHORITY_HAZARD = ERROR_CATALOG.STORAGE_AUTHORITY_UNAVAILABLE.text;

/** The bootstrap summary is cheap; the checklist only claims results from a doctor report. */
export function StorageNotice({ storage }: {
  storage: StorageHealthSummary;
}) {
  if (storage.authority === "healthy") return null;
  return <Notice sticky tone="danger" title="Storage unavailable" description={`${AUTHORITY_HAZARD} Open Settings > Storage.`} />;
}
