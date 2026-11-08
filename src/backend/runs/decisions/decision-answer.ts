import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { DecisionAnswerWireSchema, type DecisionAnswerWire } from "../../../models/dashboard/run-decision.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

export type DecisionAnswerer = (commandId: string, option: Readonly<{ id: string; label: string }>, at: string) => DecisionAnswerWire;

/** Who answered: the stored command's actor, named by the one local profile; an assistant source answers on that person's behalf. */
export function decisionAnswerer(commands: Pick<AuthorityRepositories["commands"], "get">, operatorName: () => string): DecisionAnswerer {
  return (commandId, option, at) => {
    const command = commands.get(commandId);
    if (command === undefined) throw new Error(`DECISION_ANSWER_COMMAND_MISSING: ${commandId}`);
    if (command.requestedBy !== LOCAL_OPERATOR_ACTOR_ID) throw new Error(`DECISION_ANSWER_ACTOR_UNKNOWN: ${command.requestedBy}`);
    const name = operatorName();
    return DecisionAnswerWireSchema.parse({ optionId: option.id, label: option.label, at,
      actor: command.source.startsWith("assistant") ? { kind: "assistant", onBehalfOf: { name } } : { kind: "person", name } });
  };
}
