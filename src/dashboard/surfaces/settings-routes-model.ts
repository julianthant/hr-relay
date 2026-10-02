import type { EditableSettingsLeafWire } from "../../models/dashboard/settings-editor.js";

const ROUTES: Readonly<Record<string, { readonly name: string; readonly description: string; readonly fields: Readonly<Record<string, { readonly name: string; readonly description: string }>> }>> = {
  kuali: { name: "Kuali", description: "Forms and workflows", fields: { entry: { name: "Entry", description: "Open the Kuali workspace" } } },
  newKronos: { name: "New Kronos", description: "Timekeeping", fields: { entry: { name: "Entry", description: "Open Workforce Dimensions" } } },
  crm: { name: "CRM", description: "Onboarding records and documents", fields: {
    entry: { name: "Entry", description: "Open the HR CRM workspace" },
    onboardingSearch: { name: "Onboarding search", description: "Find an onboarding record" },
    ucPathEntrySheet: { name: "UCPath entry sheet", description: "Open the entry sheet" },
    onboardingHistory: { name: "Onboarding history", description: "Review earlier onboarding activity" },
    idocsViewer: { name: "iDocs viewer", description: "View stored onboarding documents" },
  } },
  onbase: { name: "OnBase", description: "Document management", fields: { entry: { name: "Entry", description: "Open the document workspace" } } },
  ucpath: { name: "UCPath", description: "Personnel and job records", fields: {
    login: { name: "Login", description: "Open UCPath sign in" },
    smartHr: { name: "SmartHR", description: "Open the hiring task area" },
    jobSummary: { name: "Job summary", description: "Review job details" },
    personalData: { name: "Personal data", description: "Review person data" },
    personProfile: { name: "Person profile", description: "Open the person profile" },
  } },
  i9: { name: "I-9", description: "Employment eligibility verification", fields: {
    entry: { name: "Entry", description: "Open I-9 Complete" },
    app: { name: "Application", description: "Open the I-9 application" },
  } },
  oldKronos: { name: "Old Kronos", description: "Legacy timekeeping", fields: { entry: { name: "Entry", description: "Open Workforce Central" } } },
  servicenow: { name: "ServiceNow", description: "Service requests", fields: { entry: { name: "Entry", description: "Open the HR service request page" } } },
  sharepoint: { name: "SharePoint", description: "Shared files and rosters", fields: { entry: { name: "Entry", description: "Open UC San Diego SharePoint" } } },
};

export function routePresentation(leaf: EditableSettingsLeafWire) {
  const [group, system, instance] = leaf.path.split(".");
  if (group !== "urls" || instance !== "prod" || leaf.control.input !== "object" || system === undefined) {
    throw new Error("routes-section-leaf-invalid");
  }
  const route = ROUTES[system];
  if (route === undefined || leaf.control.fields.length !== Object.keys(route.fields).length
    || leaf.control.fields.some(field => route.fields[field.name] === undefined)) {
    throw new Error("routes-section-fields-mismatch");
  }
  return route;
}
