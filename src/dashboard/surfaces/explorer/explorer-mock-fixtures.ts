import type { FieldSource, FlowField, FlowPart, FlowStep } from "./explorer-flow-model.js";

// Copied presentation concepts from legacy hr-automation@9bb973672666b9267569a22d3fa0af722e4c5e87,
// src/dashboard/components/dev/rebuild-demo/demo-explorer-wire.ts and workflows/{onboarding,emergency-contact}.
export const EXPLORER_MOCK_WORKFLOWS = [
  { id: "fixture-separations", title: "Separations", count: 22 },
  { id: "fixture-onboarding", title: "Onboarding", count: 11 },
  { id: "fixture-emergency-contact", title: "Emergency Contact", count: 11 },
] as const;
export type MockWorkflowId = typeof EXPLORER_MOCK_WORKFLOWS[number]["id"];
const PATHS = {
  "fixture-hire-mode": [["new", "New hire"], ["rehire", "Concurrent hire / rehire"]],
  "fixture-documents": [["attached", "Documents attached"], ["none", "No attachments"]],
  "fixture-person": [["none", "No person found"], ["matched", "One confirmed person"], ["review", "Identity review required"], ["rejected", "Identity rejected"]],
  "fixture-i9": [["absent", "Create a profile"], ["present", "Profile already exists"]],
  "fixture-hire-posture": [["write", "Illustrate filing"], ["dry", "Dry run · stop before I-9"]],
  "fixture-contact-review": [["approved", "Contacts approved"], ["pending", "Waiting for review"], ["rejected", "Review rejected"]],
  "fixture-contact-identity": [["verified", "Employee ID verified"], ["mismatch", "Employee ID mismatch"]],
  "fixture-existing-contact": [["none", "No matching contact"], ["exact", "Exact-name duplicate"], ["fuzzy", "Fuzzy-name duplicate"]],
  "fixture-contact-address": [["same", "Same as employee"], ["manual", "Contact’s own address"]],
  "fixture-contact-posture": [["write", "Illustrate save"], ["dry", "Dry run · skip mutations"]],
} as const;
export type MockPathId = keyof typeof PATHS;
export type MockScenario = Readonly<Record<MockPathId, string>>;
export const DEFAULT_MOCK_SCENARIO: MockScenario = {
  "fixture-hire-mode": "new", "fixture-documents": "attached", "fixture-person": "none", "fixture-i9": "absent", "fixture-hire-posture": "write",
  "fixture-contact-review": "approved", "fixture-contact-identity": "verified", "fixture-existing-contact": "none", "fixture-contact-address": "same", "fixture-contact-posture": "write",
};
export function updateMockScenario(scenario: MockScenario, id: string, value: string): MockScenario {
  if (!Object.hasOwn(PATHS, id)) throw new Error(`explorer-mock-choice-unknown: ${id}`);
  const key = id as MockPathId;
  if (!PATHS[key].some(([option]) => option === value)) throw new Error(`explorer-mock-choice-invalid: ${id}:${value}`);
  return { ...scenario, [key]: value };
}
type Field = readonly [id: string, label: string, value: string, source?: string];
const rows = (mode: FlowField["mode"], fields: readonly Field[]): FlowPart => ({ kind: "rows", fields: fields.map(([id, label, value, source]) => ({ id, label, value, source, mode })) });
const form = (id: string, title: string, mode: string, ...parts: FlowPart[]): FlowPart => ({ kind: "form", id, title, mode, parts });
const action = (text: string, icon: Extract<FlowPart, { kind: "action" }>["icon"] = "verify"): FlowPart => ({ kind: "action", text, icon });
const note = (text: string): FlowPart => ({ kind: "note", text });
const step = (number: number, title: string, system: FlowStep["system"], ...parts: FlowPart[]): FlowStep => ({ number, title, system, parts });
const choice = (id: MockPathId, label: string, scenario: MockScenario): FlowPart => ({ kind: "mock-choice", id, label, value: scenario[id], options: PATHS[id] });
const stop = (text: string): FlowPart => action(text, "stop");
export interface MockFlow {
  readonly summary: string;
  readonly completion: string;
  readonly path: { readonly step: number; readonly control: string };
  readonly steps: readonly FlowStep[];
  readonly stopAfter?: number;
}

export function buildOnboardingMock(scenario: MockScenario): MockFlow {
  const rehire = scenario["fixture-hire-mode"] === "rehire";
  const person = scenario["fixture-person"];
  const dry = scenario["fixture-hire-posture"] === "dry";
  const held = person === "review" || person === "rejected" || (rehire && person === "none") || (!rehire && person === "matched");
  const personResult = person === "review" ? "Pause for identity approval. No I-9 profile or hire is filed."
    : person === "rejected" ? "Identity rejected. No I-9 profile or hire is filed."
      : rehire && person === "none" ? "Concurrent hire requires a confirmed existing employee ID."
        : !rehire && person === "matched" ? "Existing person found. Stop the new-hire path; review the hire type."
          : rehire ? "Carry the confirmed employee ID into the concurrent hire." : "No existing person found. Continue with the new hire.";
  return {
    summary: "CRM record → I-9 profile → UCPath hire",
    completion: dry && !held ? "Dry-run path ends before I-9 creation and UCPath filing" : rehire ? "Concurrent-hire receipt readback illustrated" : "New-hire receipt readback illustrated",
    path: { step: 6, control: "preview-fixture-person" },
    stopAfter: held || dry ? 6 : undefined,
    steps: [
      step(1, "Open browser sessions", undefined, { kind: "sessions", systems: rehire ? ["CRM", "UCPath"] : ["CRM", "UCPath", "I-9"] }),
      step(2, "Choose the hire type", "You", choice("fixture-hire-mode", "Hire type", scenario)),
      step(3, "Read the CRM onboarding record", "CRM", form("hire-record", "UCPath Entry Sheet", "Read only", rows("read", [
        ["email", "Email", "Supplied hire email"], ["name", "Legal name", "CRM record"], ["birth", "Date of birth · identity data", "Protected CRM fields"],
        ["address", "Address · city · state · postal code", "CRM record"], ["phone", "Phone", "CRM record"], ["wage", "Wage", "CRM appointment"],
        ["effective", "Effective date", "CRM appointment"], ["position", "Position number · appointment", "CRM appointment"], ["end", "Expected job end date", "CRM value, when supplied"],
      ])), action("Confirm the supplied email identifies this CRM record")),
      step(4, "Download attached iDocs", "CRM", choice("fixture-documents", "Attachments", scenario), ...(scenario["fixture-documents"] === "attached" ? [
        action("Open the record’s attached documents", "click"), action("Download the iDocs packet into the local hire folder", "read"), action("Read back the downloaded files"),
      ] : [action("No documents attached. Continue to person search", "rejoin")])),
      step(5, "Search for the person", "UCPath", form("person-search", "Search / Match", "Fill form", rows("fill", [["name", "Legal name", "CRM record", "hire-name"], ["identity", "Date of birth · identity data", "Protected CRM fields", "hire-identity"]])),
        action("Click Search", "click"), form("person-results", "Matching people", "Read only", rows("read", [["people", "Employee IDs · names", "Observed search results"]]))),
      step(6, "Resolve the hire identity", "You", choice("fixture-person", "Person search result", scenario), held ? stop(personResult) : action(personResult),
        choice("fixture-hire-posture", "Hire rehearsal", scenario), ...(dry && !held ? [stop("Dry-run boundary · stop before I-9 creation and Smart HR")] : [])),
      step(7, "Resolve the I-9 profile", "I-9", ...(rehire ? [action("Concurrent hire uses the existing person. Skip I-9 creation", "rejoin")] : [
        choice("fixture-i9", "I-9 profile", scenario), action("Search the portal for the hire’s existing profile", "read"),
        ...(scenario["fixture-i9"] === "present" ? [action("Read and reuse the existing profile ID", "rejoin")] : [
          form("i9-profile", "I-9 profile", "Fill form", rows("fill", [["name", "Legal name", "CRM record", "hire-name"], ["email", "Email", "CRM record", "hire-email"]])),
          action("Create the I-9 profile", "click"), action("Read the profile ID back from the portal"),
        ]),
      ])),
      step(8, "Stage the Smart HR hire", "UCPath", form("hire-template", "Smart HR · Template", "Fill form", rows("fill", [
        ["template", "Template", rehire ? "UC_CONC_HIRE" : "UC_FULL_HIRE", "hire-template"], ["effective", "Effective date", "CRM appointment", "hire-effective"],
      ])), action("Click Create Transaction", "click"),
        form("hire-details", "Smart HR · Transaction details", "Continue", rows("fill", [
          ...(rehire ? [["employee", "Employee ID", "Confirmed person-search match", "hire-person"] as const] : []),
          ["reason", "Action reason", rehire ? "Concurrent Hire - Non Dual Emp" : "Hire - No Prior UC Affiliation", "hire-template"],
        ])), action("Click Continue", "click"),
        ...(rehire ? [action("Verify the resolved employee name and acknowledge only the expected existing-person dialog")] : [
          form("personal", "Smart HR · Personal Data", "Fill form", rows("fill", [
            ["name", "Legal name", "CRM record", "hire-name"], ["identity", "Date of birth · identity data", "Protected CRM fields", "hire-identity"],
            ["address", "Address · phone · email", "CRM record", "hire-address"], ["profile", "I-9 profile ID", "Verified portal profile", "hire-profile"],
          ])),
        ]),
        form("job", "Smart HR · Job Data", "Fill form", rows("fill", [
          ["position", "Position number · appointment", "CRM appointment", "hire-position"], ["rate", "Compensation rate", "CRM wage", "hire-wage"], ["end", "Expected job end date", "CRM value or configured fiscal-year rule", "hire-end"],
        ])), action("Visit Earns Dist and the remaining required tabs", "click")),
      step(9, "Verify the staged hire", "UCPath", action("Read back the person, effective date, position and compensation"), action("Verify all required tabs and that Save and Submit is enabled")),
      step(10, "File the hire", "UCPath", action("Click Save and Submit", "click"), action("Read the transaction number from the confirmation", "read")),
      step(11, "Verify the hire receipt", "UCPath", form("hire-receipt", "Hire confirmation", "Read only", rows("read", [["transaction", "Transaction number", "Confirmation page"], ["employee", "Employee ID · name", "Post-submit person readback"], ["date", "Effective date · job row", "Post-submit employment readback"]])), action("Match the receipt to the CRM hire and employment details")),
    ],
  };
}

export function buildEmergencyContactMock(scenario: MockScenario): MockFlow {
  const review = scenario["fixture-contact-review"];
  const mismatch = scenario["fixture-contact-identity"] === "mismatch";
  const existing = scenario["fixture-existing-contact"];
  const duplicate = existing === "exact";
  const dry = scenario["fixture-contact-posture"] === "dry";
  const manual = scenario["fixture-contact-address"] === "manual";
  return {
    summary: "Scanned packet → contact review → UCPath contact",
    completion: duplicate ? "Exact-name duplicate path skips fill and save" : dry ? "Dry-run path skips primary demotion and Save" : "Contact save and per-person readback illustrated",
    path: { step: 3, control: "preview-fixture-contact-review" },
    stopAfter: review !== "approved" ? 3 : mismatch ? 5 : undefined,
    steps: [
      step(1, "Open browser sessions", undefined, { kind: "sessions", systems: ["UCPath"] }, note("Authentication waits until the contact packet is reviewed.")),
      step(2, "Extract the contact packet", "OCR", action("Delegate the scanned packet to OCR review", "read"), form("contact-record", "Emergency Contact Form", "Read only", rows("read", [
        ["page", "Source page", "Page carrying this contact block"], ["employee", "Employee ID · name", "Scanned form"], ["contact", "Contact name", "Scanned form"],
        ["relationship", "Relationship", "Scanned form"], ["phone", "Cell · home · work phone", "Scanned form"], ["address", "Contact address · employee address", "Scanned form"],
      ])), action("Exclude pages without a contact block; flag uncertain fields")),
      step(3, "Review the extracted contacts", "You", choice("fixture-contact-review", "Contact review", scenario), review === "approved" ? action("Use only the approved contact records") : stop(review === "pending" ? "Waiting for contact review. No person fill is enqueued." : "Contact review rejected. No person fill is enqueued.")),
      step(4, "Fan out approved people", "Local", action("Enqueue one per-person fill for each approved record", "compute"), note("Each person keeps a separate outcome. The packet waits for all people to become terminal.")),
      step(5, "Open the employee contact page", "UCPath", action("Authenticate the per-person session after packet review"), form("employee-search", "Emergency Contacts · employee", "Fill form", rows("fill", [["employee", "Employee ID", "Approved employee record", "contact-employee"]])),
        action("Open the employee’s emergency-contact editor", "click"), form("employee-header", "Employee header", "Read only", rows("read", [["person-id", "Person ID · employee name", "Current UCPath editor"]])),
        choice("fixture-contact-identity", "Contact identity", scenario), mismatch ? stop("Displayed employee ID does not match. Stop before contact changes.") : action("Verify the displayed Person ID against the approved record")),
      step(6, "Check existing contacts", "UCPath", form("existing-contacts", "Saved contacts", "Read only", rows("read", [["names", "Contact names · primary flags", "Every saved contact row"]])),
        choice("fixture-existing-contact", "Existing contact", scenario), choice("fixture-contact-posture", "Contact rehearsal", scenario),
        ...(duplicate ? [action("Exact-name duplicate already exists. Skip form fill and Save", "rejoin")] : [action(existing === "fuzzy" ? "Fuzzy-name duplicate found. Preserve it as a non-primary contact before adding the corrected name." : "No matching contact. Continue with a new contact row.")])),
      ...(!duplicate ? [
        step(7, "Prepare the contact row", "UCPath", ...(existing === "fuzzy" ? [dry ? action("Dry run: skip demoting the existing primary contact") : action("Demote the existing fuzzy-name primary and read back that row")] : [action("Keep existing saved contacts")]), action("Reuse a blank contact row, or add a row when every existing row is named", "click")),
        step(8, "Fill the approved contact", "UCPath", choice("fixture-contact-address", "Contact address", scenario), form("contact-fill", "Emergency Contacts · contact details", "Fill form", rows("fill", [
          ["primary", "Primary contact", "Checked", "contact-primary"], ["relationship", "Relationship", "Mapped UCPath relationship option", "contact-relationship"],
          ["same-address", "Same address as employee", manual ? "Unchecked" : "Checked", "contact-address"],
          ...(manual ? [["address", "Street · city · state · postal code · country", "Approved contact address", "contact-address"] as const] : []),
          ["phone", "Cell · home · work phone", "Approved contact phones", "contact-phone"], ["contact", "Contact name", "Approved contact name · entered last", "contact-name"],
        ]))),
        step(9, "Verify the staged contact", "UCPath", action("Read back the contact name after every form postback"), action("Confirm the approved name remains present and every contact row has a name")),
        ...(!dry ? [step(10, "Save and verify the contact", "UCPath", action("Click Save", "click"), action("Read the saved contact row back from the employee’s record"), action("Verify the contact name, relationship, primary flag and phone values"))] : []),
      ] : []),
      step(11, "Roll up the packet", "Local", action(duplicate ? "Report this person as skipped because the exact contact exists" : dry ? "Report the staged rehearsal; no contact save or primary demotion" : "Report each person’s own saved-contact proof", "compute"), action("Close the packet only after every approved person is terminal")),
    ],
  };
}

const crm = (field: string, fieldId: string): FieldSource => ({ reads: [{ system: "CRM", page: "UCPath Entry Sheet", field, step: 3, fieldId }] });
const contact = (field: string, fieldId: string): FieldSource => ({ reads: [{ system: "OCR", page: "Emergency Contact Form", field, step: 2, fieldId }], chain: [{ step: 3, title: "Approve the contact record", detail: "Use only the fields approved during packet review." }] });
const MOCK_SOURCES: Readonly<Record<string, FieldSource>> = {
  "hire-name": crm("Legal name", "name"), "hire-identity": crm("Protected identity data", "birth"), "hire-email": crm("Email", "email"), "hire-address": crm("Address · phone · email", "address"),
  "hire-effective": crm("Effective date", "effective"), "hire-position": crm("Position number · appointment", "position"), "hire-wage": crm("Wage", "wage"),
  "hire-end": { ...crm("Expected job end date", "end"), detail: "When no CRM end date is supplied, use the configured fiscal-year rule.", origin: "CRM value or configured rule" },
  "hire-person": { reads: [{ system: "UCPath", page: "Search / Match", field: "Confirmed employee ID", step: 5, fieldId: "people" }], chain: [{ step: 6, title: "Resolve identity", detail: "Confirm the matched person before staging a concurrent hire." }] },
  "hire-profile": { reads: [{ system: "I-9", page: "Profile", field: "Verified profile ID", step: 7 }] },
  "hire-template": { origin: "Hire type", detail: "New hire uses UC_FULL_HIRE and Hire - No Prior UC Affiliation. Concurrent hire uses UC_CONC_HIRE and Concurrent Hire - Non Dual Emp." },
  "contact-employee": contact("Employee ID · name", "employee"), "contact-name": contact("Contact name", "contact"), "contact-phone": contact("Cell · home · work phone", "phone"),
  "contact-address": contact("Contact address · employee address", "address"),
  "contact-relationship": { ...contact("Relationship", "relationship"), chain: [{ step: 3, title: "Approve the contact record", detail: "Approve the relationship transcribed from the form." }, { step: 8, title: "Map the relationship", detail: "Resolve the approved relationship to its UCPath dropdown option." }] },
  "contact-primary": { origin: "Contact form convention", detail: "The single approved emergency contact is marked primary. A fuzzy-name existing primary is demoted only on the filing path." },
};
export function mockFieldSource(key: string): FieldSource | undefined { return MOCK_SOURCES[key]; }
