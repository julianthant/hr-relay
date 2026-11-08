import type { CandidateTableWire, DecisionAnswerWire, DecisionOptionWire, RunDecisionWire } from "../../../../models/dashboard/run-decision.js";
import type { LogScreenshot } from "./log-feed-model.js";

/** What the operator entered for one served option: a picked row, a typed value, a date, text or a verification outcome. */
export type LogDecisionAnswer = Readonly<{ outcome?: "present" | "absent"; transaction?: string; candidate?: string; typed?: string; date?: string; text?: string }>;
export type LogDecision = Readonly<{
  title: string;
  state: "parked" | "failed" | "review" | "held" | "unconfirmed" | "loading" | "recorded" | "resolved";
  message?: string;
  attemptedAction?: string;
  lastCompleted?: string;
  field?: Readonly<{ label: string; value: string; outcome: string }>;
  caution?: string;
  comparison?: readonly Readonly<{ label: string; expected: string; observed: string }>[];
  screenshots?: readonly LogScreenshot[];
  unavailableCapture?: string;
  footer?: string;
  /** The served decision: its options, hints, recommended option and inputs. */
  served?: RunDecisionWire;
  /** The served answer record; the decision shows as one answered line. */
  answered?: DecisionAnswerWire;
}>;
export const LOG_DECISION_STATUS = {
  parked: { label: "Write parked", tone: "warning", className: "text-ui-warning" }, failed: { label: "Failed", tone: "danger", className: "text-ui-danger" }, review: { label: "Review", tone: "info", className: "text-ui-info" }, held: { label: "Held", tone: "warning", className: "text-ui-warning" }, unconfirmed: { label: "Unconfirmed", tone: "warning", className: "text-ui-warning" }, loading: { label: "Loading", tone: "muted", className: "text-ui-muted" }, recorded: { label: "Recorded", tone: "muted", className: "text-ui-muted" }, resolved: { label: "Resolved", tone: "muted", className: "text-ui-muted" },
} as const;

/** The selection when the operator is typing their own value instead of picking a served row. */
export const TYPED_ROW = "\u0001typed";

/** The Cancel run button sends this option's descriptor; it is never a dropdown choice. */
export const isCancelOption = (option: DecisionOptionWire): boolean => option.send.via === "row-action" && option.id === "cancel-run";
export const choiceOptions = (decision: RunDecisionWire): readonly DecisionOptionWire[] => decision.options.filter(option => !isCancelOption(option));
export const recommendedOption = (decision: RunDecisionWire): DecisionOptionWire | undefined => {
  const choices = choiceOptions(decision);
  return choices.find(option => option.recommended) ?? choices[0];
};

/** A typed pick value must match the served pattern and name a served row, by its employee ID or its row number. */
export function typedPickRow(table: CandidateTableWire, typed: string): CandidateTableWire["rows"][number] | undefined {
  const value = typed.trim();
  if (table.typed === undefined || !new RegExp(table.typed.pattern, "u").test(value)) return undefined;
  return table.rows.find(row => row.eid === value || row.rowNumber === Number(value));
}
export function decisionAnswerValid(option: DecisionOptionWire, answer: LogDecisionAnswer): boolean {
  const input = option.input;
  switch (input?.kind) {
    case "verification": {
      if (option.send.via !== "verification") return false;
      return answer.outcome === "absent" || (answer.outcome === "present" && new RegExp(option.send.transactionPattern, "u").test(answer.transaction?.trim() ?? ""));
    }
    case "candidate": {
      const picked = answer.candidate !== undefined && input.table.rows.some(row => row.id === answer.candidate);
      const typed = answer.typed !== undefined && answer.typed.trim() !== "" && typedPickRow(input.table, answer.typed) !== undefined;
      return picked !== typed;
    }
    case "text": {
      const text = answer.text?.trim() ?? "";
      return text.length > 0 && (input.pattern === undefined || new RegExp(input.pattern, "u").test(text));
    }
    case "date": {
      if (!answer.date || !/^\d{4}-\d{2}-\d{2}$/u.test(answer.date)) return false;
      const date = new Date(`${answer.date}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === answer.date;
    }
    case undefined: return true;
  }
}
/** The row a candidate answer names: the picked row, or the served row a typed row number matches. */
export function answeredRow(option: DecisionOptionWire, answer: LogDecisionAnswer): CandidateTableWire["rows"][number] | undefined {
  if (option.input?.kind !== "candidate") return undefined;
  const table = option.input.table;
  if (answer.candidate !== undefined) return table.rows.find(row => row.id === answer.candidate);
  return answer.typed === undefined ? undefined : typedPickRow(table, answer.typed);
}
