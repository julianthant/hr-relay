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

/** Names in running text; `SYSTEM_LABEL` is the chip's capitalised form. Local work has no system name. */
export const SYSTEM_NAME: Readonly<Record<BrowserSystemId, string>> = {
  ucpath: "UCPath", crm: "CRM", onbase: "OnBase", kuali: "Kuali", servicenow: "ServiceNow", i9: "I-9",
  "new-kronos": "Kronos", "old-kronos": "Kronos", sharepoint: "SharePoint",
};
