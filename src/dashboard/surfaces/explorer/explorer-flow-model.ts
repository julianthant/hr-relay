export interface PreviewScenario {
  readonly identity: "verified" | "review" | "rejected";
  readonly pending: "none" | "some" | "unknown";
  readonly termination: "absent" | "present" | "unknown";
}

export const DEFAULT_SCENARIO: PreviewScenario = { identity: "verified", pending: "none", termination: "absent" };
export interface CommentChoices {
  readonly leave: "none" | "sick" | "holiday" | "range" | "tie" | "operator";
  readonly changes: "none" | "last" | "separation" | "both";
  readonly authority: "kronos" | "operator";
  readonly existing: "no" | "yes";
}
export const DEFAULT_COMMENTS: CommentChoices = { leave: "none", changes: "none", authority: "kronos", existing: "no" };
export interface FlowField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly mode: "read" | "fill" | "compute";
  readonly source?: string;
  readonly template?: "ucpath" | "kuali" | "duplicate";
}
export type FlowPart =
  | { readonly kind: "form"; readonly id: string; readonly title: string; readonly mode: string; readonly parts: readonly FlowPart[]; readonly result?: "pending" }
  | { readonly kind: "rows"; readonly fields: readonly FlowField[] }
  | { readonly kind: "action"; readonly text: string; readonly icon: "click" | "read" | "verify" | "compute" | "key" | "rejoin" | "stop" }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "detail"; readonly id: string; readonly title: string; readonly parts: readonly FlowPart[] }
  | { readonly kind: "choice"; readonly choice: "identity" | "termination" }
  | { readonly kind: "mock-choice"; readonly id: string; readonly label: string; readonly value: string; readonly options: readonly (readonly [value: string, label: string])[] }
  | { readonly kind: "resume"; readonly step: number; readonly text: string }
  | { readonly kind: "sessions"; readonly systems?: readonly string[] };
export interface FlowStep {
  readonly number: number;
  readonly title: string;
  readonly system?: "Kuali" | "Kronos" | "UCPath" | "Local" | "You" | "CRM" | "I-9" | "OCR" | "OnBase" | "ServiceNow" | "SharePoint";
  readonly parts: readonly FlowPart[];
}
export interface FieldSource {
  readonly origin?: string;
  readonly detail?: string;
  readonly reads?: readonly { readonly system: string; readonly page: string; readonly field: string; readonly step: number; readonly fieldId?: string }[];
  readonly chain?: readonly { readonly step: number; readonly title: string; readonly detail: string }[];
}

export function allFields(parts: readonly FlowPart[]): FlowField[] {
  return parts.flatMap((part) => part.kind === "rows" ? [...part.fields] : part.kind === "form" || part.kind === "detail" ? allFields(part.parts) : []);
}

export function blockedAfter(scenario: PreviewScenario): number | undefined {
  if (scenario.identity === "rejected") return 15;
  if (scenario.pending === "unknown") return 18;
  if (scenario.termination === "unknown") return 19;
  return undefined;
}

export const LEAVE_OPTIONS = [
  ["none", "No leave"], ["sick", "Sick leave takes precedence"], ["holiday", "One holiday date"],
  ["range", "Holiday date range"], ["tie", "Sick / holiday dates tie"], ["operator", "Kronos omitted · operator dates"],
] as const;
export const LEAVE_CONDITIONS: Record<CommentChoices["leave"], string> = {
  none: "No sick or holiday dates were read. No leave clause is added.",
  sick: "Sick leave is the only leave type, or its latest date is later than the latest holiday date.",
  holiday: "One holiday date is present and no later or tied sick date takes precedence.",
  range: "Multiple holiday dates are present; the latest holiday is later than the latest sick date, if any.",
  tie: "The latest sick and holiday dates are equal. Sick leave wins the tie.",
  operator: "The Kronos step is omitted and dates are supplied by the operator. No leave clause is added.",
};
export function commentTemplate(kind: "ucpath" | "kuali", choices: CommentChoices): string {
  if (kind === "ucpath") {
    const clause = { none: "", sick: " Sick Leave on {latestSickDate}.", holiday: " Holiday Pay on {firstHolidayDate}.", range: " Holiday Pay from {firstHolidayDate} to {latestHolidayDate}.", tie: " Sick Leave on {latestSickDate}.", operator: "" }[choices.leave];
    return `Termination eff {terminationEffectiveDate}. Last Day Worked {lastDayWorked}.${clause} Kuali form #{documentNumber}.`;
  }
  const lines: string[] = choices.existing === "yes" ? ["{existingComments}"] : [];
  const authority = choices.authority === "kronos" ? "per Kronos timesheet" : "per operator entry at run start";
  if (choices.changes === "last" || choices.changes === "both") lines.push(`Updated Last Day Worked from {kualiLastDayWorked} to {lastDayWorked} ${authority}. -{initials}`);
  if (choices.changes === "separation" || choices.changes === "both") lines.push(`Updated Separation Date from {kualiSeparationDate} to {separationDate} ${authority}. -{initials}`);
  lines.push("Termination filed on UCPath as {transactionNumber}. Re Kuali Form #{documentNumber}. -{initials} {asOfDate}");
  return lines.join("\n");
}
