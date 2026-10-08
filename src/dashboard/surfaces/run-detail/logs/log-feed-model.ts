import type { LogDecision } from "./log-decision-model.js";

export type LogField = Readonly<{
  id: string;
  time: string;
  kind: "read" | "fill" | "compute";
  label: string;
  value: string;
}>;

export type LogScreenshot = Readonly<{
  src: string;
  alt: string;
  time: string;
  width: number;
  height: number;
  label?: string;
  kind?: "fields" | "form" | "browser" | "person";
  system?: string;
}>;

export type LogEntry = Readonly<{
  kind: "fields";
  id: string;
  title?: string;
  fields: readonly LogField[];
  result?: string;
  screenshots?: readonly LogScreenshot[];
}> | Readonly<{
  kind: "click";
  id: string;
  time: string;
  label: string;
  screenshots?: readonly LogScreenshot[];
}> | Readonly<{
  kind: "note";
  id: string;
  time: string;
  message: string;
  tone?: "info" | "danger" | "positive";
  announce?: boolean;
}> | Readonly<{
  kind: "decision";
  id: string;
  time: string;
  decision: LogDecision;
}>;

export type LogStep = Readonly<{
  id: string;
  time: string;
  title: string;
  system?: string;
  header?: boolean;
  entries: readonly LogEntry[];
}>;

export function visualLogSteps(steps: readonly LogStep[]): readonly LogStep[] {
  return steps.flatMap(step => {
    const entries = step.entries.flatMap<LogEntry>(entry => {
      if (entry.kind !== "fields") return [entry];
      const fields = entry.fields.filter(field => field.kind !== "compute");
      return fields.length ? [{ ...entry, fields }] : [];
    });
    return entries.length ? [{ ...step, entries }] : [];
  });
}

export function logEntryText(entry: LogEntry): string {
  switch (entry.kind) {
    case "fields": return [entry.title, ...entry.fields.map(field => `${field.time} ${field.label} ${field.value}`), entry.result].filter(Boolean).join(" ");
    case "click": return `${entry.time} ${entry.label}`;
    case "note": return `${entry.time} ${entry.message}`;
    case "decision": return [entry.time, entry.decision.title, entry.decision.message, entry.decision.attemptedAction, entry.decision.lastCompleted, entry.decision.field?.label, entry.decision.field?.value, entry.decision.caution, entry.decision.footer, ...(entry.decision.comparison ?? []).map(row => `${row.label} ${row.expected} ${row.observed}`)].filter(Boolean).join(" ");
  }
}

export function filterLogSteps(steps: readonly LogStep[], query: string): readonly LogStep[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return steps;
  return steps.flatMap(step => {
    if (`${step.title} ${step.system ?? ""}`.toLocaleLowerCase().includes(needle)) return [step];
    const entries = step.entries.filter(entry => logEntryText(entry).toLocaleLowerCase().includes(needle));
    return entries.length ? [{ ...step, entries }] : [];
  });
}

export function logRowCount(steps: readonly LogStep[]): number {
  return steps.reduce((count, step) => count + step.entries.reduce((total, entry) => total + (entry.kind === "fields" ? entry.fields.length : 1), 0), 0);
}

export function logPlainText(steps: readonly LogStep[]): string {
  return steps.map(step => `${step.time} ${step.title}${step.system ? ` · ${step.system}` : ""}\n${step.entries.map(entry => {
    if (entry.kind !== "fields") return logEntryText(entry);
    return [entry.title, ...entry.fields.map(field => `${field.time} ${field.label}: ${field.value}`), entry.result ? `Result: ${entry.result}` : undefined].filter(Boolean).join("\n");
  }).join("\n")}`).join("\n\n");
}
