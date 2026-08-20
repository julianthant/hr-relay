/**
 * Closed presentation labels for the closed `BrowserSystemId` enum.
 *
 * An explicit map rather than the demo's bare `toUpperCase()`, which would
 * render `NEW-KRONOS` for a system whose operator name is two words. It lives
 * beside `system-chip.tsx` rather than inside it because a module that exports
 * a component may export nothing else if React Fast Refresh is to treat it as a
 * refresh boundary.
 */
import type { z } from "zod";
import type { BrowserSystemIdSchema } from "../../domain/ids.js";

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
