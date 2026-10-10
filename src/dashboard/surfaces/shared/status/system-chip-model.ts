/** Closed presentation labels for the closed `BrowserSystemId` enum.
 * An explicit map rather than the demo's bare `toUpperCase`, which would */
import type { z } from "zod";
import type { BrowserSystemIdSchema } from "../../../../rules/identity/ids.js";

export type BrowserSystemId = z.infer<typeof BrowserSystemIdSchema>;

export const SYSTEM_LABEL: Record<BrowserSystemId, string> = {
  ucpath: "UCPATH",
  crm: "CRM",
  onbase: "ONBASE",
  kuali: "KUALI",
  servicenow: "SERVICENOW",
  i9: "I9",
  "new-kronos": "NEW KRONOS",
  "old-kronos": "OLD KRONOS",
  sharepoint: "SHAREPOINT",
};
