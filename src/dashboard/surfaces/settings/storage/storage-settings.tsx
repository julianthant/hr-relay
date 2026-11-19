import { FailureNotice } from "../../../ds/ui.js";
import type { StorageHealthSummary } from "./storage-settings-model.js";

/** The bootstrap summary is cheap; the checklist only claims results from a doctor report. */
export function StorageNotice({ storage }: {
  storage: StorageHealthSummary;
}) {
  if (storage.authority === "healthy") return null;
  return <div className="px-[var(--ds-space-base)] pt-[var(--ds-space-base)]"><FailureNotice sentence="Storage is unavailable." /></div>;
}
