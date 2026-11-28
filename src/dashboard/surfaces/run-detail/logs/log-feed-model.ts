import type { LogDecision } from "./log-decision-model.js";

export type LogField = Readonly<{
  id: string;
  time: string;
  kind: "read" | "fill" | "compute";
  label: string;
  value: string;
  /** Where a typed value came from, written beside it. */
  mark?: string;
  /** The read failed before a value was observed. */
  unread?: true;
}>;

export type LogScreenshot = Readonly<{
  logId?: string;
  boundary?: "step" | "before-submit" | "after-submit";
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
  captureFailure?: "pre-submit-failed" | "post-submit-unknown" | "post-submit-proved";
  tone?: "info" | "danger" | "positive";
  /** A recorded step's state, drawn as its icon. */
  state?: "done" | "active" | "failed";
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
    case "fields": return [entry.title, ...entry.fields.map(field => `${field.time} ${field.label} ${field.value}${field.mark === undefined ? "" : ` ${field.mark}`}`), entry.result].filter(Boolean).join(" ");
    case "click": return `${entry.time} ${entry.label}`;
    case "note": return `${entry.time} ${entry.message}`;
    case "decision": return [entry.time, entry.decision.title, entry.decision.message, entry.decision.attemptedAction, entry.decision.lastCompleted, entry.decision.field?.label, entry.decision.field?.value, entry.decision.caution, entry.decision.unavailableCapture, entry.decision.footer, ...(entry.decision.comparison ?? []).map(row => `${row.label} ${row.expected} ${row.observed}`)].filter(Boolean).join(" ");
  }
}

/** Text no one can see: screen-reader copies, hidden or collapsed content, and form control values. */
const UNSEARCHED = ".sr-only, [hidden], textarea, select, details:not([open]) > :not(summary)";

/** Every occurrence of `query` in the text drawn inside `container`, in document order. A match never spans two text nodes. */
export function matchRanges(container: Element, query: string): Range[] {
  const needle = query.trim().toLocaleLowerCase();
  const ranges: Range[] = [];
  if (!needle) return ranges;
  const walker = container.ownerDocument.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement?.closest(UNSEARCHED)) continue;
    const text = (node.textContent ?? "").toLocaleLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = container.ownerDocument.createRange();
      range.setStart(node, at); range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

export function logPlainText(steps: readonly LogStep[]): string {
  return steps.map(step => `${step.time} ${step.title}${step.system ? ` · ${step.system}` : ""}\n${step.entries.map(entry => {
    if (entry.kind !== "fields") return logEntryText(entry);
    return [entry.title, ...entry.fields.map(field => `${field.time} ${field.label}: ${field.value}${field.mark === undefined ? "" : ` · ${field.mark}`}`), entry.result ? `Result: ${entry.result}` : undefined].filter(Boolean).join("\n");
  }).join("\n")}`).join("\n\n");
}
