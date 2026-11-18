import type { TimelineTypedValuesWire, TimelineUsesTypedWire } from "../../../../models/dashboard/run-detail.js";
import type { LogEntry } from "./log-feed-model.js";

export const REPLACED_READING = "Automatic reading replaced with operator-entered values.";
const WITHHELD_VALUE = "Not shown";

/** The group a typed step opens with: each served label and value, each marked by where it came from. */
export function typedValuesEntry(stepId: string, time: string, typed: TimelineTypedValuesWire): LogEntry {
  return { kind: "fields", id: `${stepId}:typed-values`, title: typed.title,
    fields: typed.fields.map(field => ({ id: `${stepId}:typed:${field.key}`, time, kind: "fill", label: field.label,
      value: "withheld" in field ? WITHHELD_VALUE : field.value, mark: field.mark })) };
}

/** The line a later step shows when it reads values typed for another step. */
export function usesTypedEntry(stepId: string, time: string, uses: TimelineUsesTypedWire): LogEntry {
  return { kind: "note", id: `${stepId}:uses-typed`, time, message: uses.line };
}
