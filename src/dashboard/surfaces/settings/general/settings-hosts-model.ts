import type { BrowserSystemId } from "../../shared/status/system-chip-model.js";

/** Display names for the production endpoints exposed by the read-only summary. */
export interface SystemHostPresentation {
  readonly name: string;
}

export const SYSTEM_HOST_PRESENTATION: Record<BrowserSystemId, SystemHostPresentation> = {
  ucpath: { name: "UCPath" },
  kuali: { name: "Kuali" },
  crm: { name: "CRM" },
  servicenow: { name: "ServiceNow" },
  onbase: { name: "OnBase" },
  i9: { name: "I-9" },
  "new-kronos": { name: "New Kronos" },
  "old-kronos": { name: "Old Kronos" },
  sharepoint: { name: "SharePoint" },
};
