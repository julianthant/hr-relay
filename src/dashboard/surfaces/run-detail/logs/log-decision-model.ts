import type { LogScreenshot } from "./log-feed-model.js";

export type LogDecisionAnswer = Readonly<{ outcome?: "present" | "absent"; transaction?: string; candidate?: string; date?: string; text?: string }>;
export type LogDecisionAction = Readonly<{
  id: string;
  label: string;
  primary?: boolean;
  input?: Readonly<{ kind: "verification"; question: string }> | Readonly<{ kind: "date"; label: string }> | Readonly<{ kind: "candidate"; question: string; candidates: readonly Readonly<{ id: string; name: string; description: string }>[] }> | Readonly<{ kind: "text"; label: string; placeholder?: string; hint?: string; pattern?: string }>;
  result: Readonly<{ title: string; message: string; tone?: "info" | "danger" | "positive"; continues?: boolean }>;
}>;
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
  actions?: readonly LogDecisionAction[];
}>;
export const LOG_DECISION_STATUS = {
  parked: { label: "Write parked", tone: "warning", className: "text-ui-warning" }, failed: { label: "Failed", tone: "danger", className: "text-ui-danger" }, review: { label: "Review", tone: "info", className: "text-ui-info" }, held: { label: "Held", tone: "warning", className: "text-ui-warning" }, unconfirmed: { label: "Unconfirmed", tone: "warning", className: "text-ui-warning" }, loading: { label: "Loading", tone: "muted", className: "text-ui-muted" }, recorded: { label: "Recorded", tone: "muted", className: "text-ui-muted" }, resolved: { label: "Resolved", tone: "muted", className: "text-ui-muted" },
} as const;
export function decisionAnswerValid(action: LogDecisionAction, answer: LogDecisionAnswer): boolean {
  switch (action.input?.kind) {
    case "verification": return answer.outcome === "absent" || (answer.outcome === "present" && !!answer.transaction?.trim());
    case "candidate": return action.input.candidates.some(candidate => candidate.id === answer.candidate);
    case "text": {
      const text = answer.text?.trim() ?? "";
      return text.length > 0 && (action.input.pattern === undefined || new RegExp(action.input.pattern, "u").test(text));
    }
    case "date": {
      if (!answer.date || !/^\d{4}-\d{2}-\d{2}$/u.test(answer.date)) return false;
      const date = new Date(`${answer.date}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === answer.date;
    }
    case undefined: return true;
  }
}
export function decisionActionResult(action: LogDecisionAction, answer: LogDecisionAnswer): LogDecisionAction["result"] {
  if (!decisionAnswerValid(action, answer)) throw new Error("log-decision-answer-incomplete");
  if (action.input?.kind === "verification") return answer.outcome === "present"
    ? { title: "Termination confirmed", message: `Transaction ${answer.transaction?.trim()} is present. Continued to Finalize Kuali document.`, tone: "positive" as const, continues: true }
    : { title: "Termination not submitted", message: "No matching termination was found. Continued to retry the termination.", tone: "info", continues: true };
  if (action.input?.kind === "candidate") return { ...action.result, message: `Selected ${answer.candidate}. ${action.result.message}` };
  if (action.input?.kind === "date") return { ...action.result, message: `Last day worked: ${answer.date}. ${action.result.message}` };
  if (action.input?.kind === "text") return { ...action.result, message: `${action.input.label}: ${answer.text?.trim()}. ${action.result.message}` };
  return action.result;
}
