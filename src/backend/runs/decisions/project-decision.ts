import type { ActionConfirmWireSchema } from "../../../models/dashboard/actions.js";
import { RunDecisionWireSchema, type DecisionAnswerWire, type DecisionInputWire, type DecisionSend, type RunDecisionType, type RunDecisionWire } from "../../../models/dashboard/run-decision.js";
import { DECISION_CATALOG } from "./decision-catalog.js";
import type { z } from "zod";

/** One option this instance serves: its catalog id, its bound send, and any instance text the owner declared. */
export type ServedOption = Readonly<{
  id: string;
  send: DecisionSend;
  label?: string;
  hint?: string;
  input?: DecisionInputWire;
  confirm?: z.infer<typeof ActionConfirmWireSchema>;
}>;

/** Orders served options by the catalog, takes catalog text unless the owner declared its own, and preselects the first recommended one served. */
export function projectDecision(type: RunDecisionType, served: readonly ServedOption[], extra: Readonly<{ title?: string; context?: string; answer?: DecisionAnswerWire }> = {}): RunDecisionWire {
  const declaration = DECISION_CATALOG[type];
  if (declaration.projected === false) throw new Error(`decision ${type} is catalog-only`);
  const ordered = declaration.gateArms ? served : declaration.options.flatMap(option => {
    const match = served.find(candidate => candidate.id === option.id);
    return match === undefined ? [] : [{ ...match, label: match.label ?? option.label, hint: match.hint ?? option.hint }];
  });
  if (!declaration.gateArms && ordered.length !== served.length) throw new Error(`decision ${type} served an undeclared option`);
  const recommended = declaration.gateArms ? ordered[0]?.id : declaration.recommended.find(id => ordered.some(option => option.id === id));
  return RunDecisionWireSchema.parse({
    type,
    title: extra.title ?? declaration.title,
    ...(extra.context === undefined ? {} : { context: extra.context }),
    ...(declaration.choiceLabel === undefined ? {} : { choiceLabel: declaration.choiceLabel }),
    options: ordered.map(option => {
      if (option.label === undefined || option.hint === undefined) throw new Error(`decision ${type} option ${option.id} has no text`);
      return {
        id: option.id, label: option.label, hint: option.hint, send: option.send,
        ...(option.id === recommended ? { recommended: true } : {}),
        ...(option.input === undefined ? {} : { input: option.input }),
        ...(option.confirm === undefined ? {} : { confirm: option.confirm }),
      };
    }),
    ...(extra.answer === undefined ? {} : { answer: extra.answer }),
  });
}

/** The run's own queue-row descriptor for `command`, bound as a row action with its served key, label and confirm. */
export function rowActionOption(id: string, command: string, actions: readonly Readonly<{ kind: string; key: string; label: string; command?: string; confirm?: z.infer<typeof ActionConfirmWireSchema> }>[] | undefined): ServedOption[] {
  const action = actions?.find(candidate => candidate.kind === "command" && candidate.command === command);
  return action === undefined ? [] : [{ id, send: { via: "row-action", actionKey: action.key }, label: action.label, ...(action.confirm === undefined ? {} : { confirm: action.confirm }) }];
}
