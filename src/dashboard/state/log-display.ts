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
