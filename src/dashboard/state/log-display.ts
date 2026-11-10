import type { IdentityGateDetail } from "../surfaces/run-detail/identity/identity-ceremony.js";

const STEP_LABELS: Readonly<Record<string, string>> = {
  searching: "Search for the person",
  "cross-verify": "Compare UCPath and CRM",
  "active-status": "Check active status",
  "crm-dates": "Compare appointment dates",
  "gate:identity-review": "Confirm the person",
};

/** A served step key becomes words; a label that is already words stays. */
export function plainStepLabel(label: string): string {
  const known = STEP_LABELS[label];
  if (known !== undefined) return known;
  if (!/^[a-z][a-z0-9:-]*$/.test(label)) return label;
  const words = label.replace(/^gate:/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const COMPARISON_LABELS: Readonly<Record<string, string>> = { name: "Name", eid: "Employee ID", employment: "Job", "name-search": "Name search" };
const EID_SOURCE_MESSAGES: Readonly<Record<IdentityGateDetail["packet"]["emplIdSource"], string>> = {
  "document-eid": "The request's Employee ID found this person.",
  "canonical-eid": "Relay was given this Employee ID.",
  "operator-entered": "You entered this Employee ID.",
  "name-resolved": "The request had no Employee ID, so Relay found this person by name.",
};
const CHOSEN_FROM_LABELS: Readonly<Record<IdentityGateDetail["options"][number]["chosenFrom"], string>> = {
  checked: "The person checked", "name-search": "Found by name", manual: "Entered by you",
};

const plainJobs = (value: string) => {
  const active = /(\d+) active of/.exec(value)?.[1];
  return active === undefined ? value : active === "0" ? "No active job" : `${active} active job${active === "1" ? "" : "s"}`;
};

/** Plain labels and values for the identity gate; the packet's policy notes stay in evidence. */
export function identityGateDisplay(packet: IdentityGateDetail["packet"]) {
  return {
    message: `${EID_SOURCE_MESSAGES[packet.emplIdSource]} Check it is the right person.`,
    comparison: packet.comparisons.map(item => ({ label: COMPARISON_LABELS[item.field] ?? plainStepLabel(item.field),
      expected: item.documentValue, observed: item.field === "employment" ? plainJobs(item.ucpathValue) : item.ucpathValue })),
  };
}

export const chosenFromLabel = (source: IdentityGateDetail["options"][number]["chosenFrom"]) => CHOSEN_FROM_LABELS[source];
