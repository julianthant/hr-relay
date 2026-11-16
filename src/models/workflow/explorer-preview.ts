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
