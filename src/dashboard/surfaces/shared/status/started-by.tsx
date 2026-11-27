import { createContext, useContext } from "react";
import { cn } from "../../../lib/utils.js";
import { dsText } from "../../../ds/ui.js";
import type { QueueSurfaceWire } from "../../queue/queue-model.js";

/** The signed-in operator's name (bootstrap actor.label), for the assistant attribution line. */
export const OperatorLabelContext = createContext("the operator");

/** "Started by the assistant for <operator> · read only", on a run an assistant command started; nothing otherwise. */
export function StartedByLine({ surface, className }: { surface: Pick<QueueSurfaceWire, "startedBy">; className?: string }) {
  const operator = useContext(OperatorLabelContext);
  if (surface.startedBy === undefined) return null;
  return <span data-started-by className={cn(dsText.meta, "min-w-0 truncate", className)}>
    Started by the assistant for {operator}{surface.startedBy.readOnly ? " · read only" : ""}</span>;
}
