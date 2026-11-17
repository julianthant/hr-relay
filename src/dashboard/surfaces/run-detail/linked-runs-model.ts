/** The Linked runs popover entries for one run: its served parent and the runs it delegated to. */
import { dsStatusOf, statusText } from "../shared/status/status-model.js";
import type { LinkedRunWire, QueueSurfaceWire } from "../queue/queue-model.js";

export type LinkedRunEntry = Readonly<{ name: string; workflow: string; status: string; relation: "Parent" | "Child"; target: LinkedRunWire }>;

/** The served parent first, then the runs it delegated to; the wire carries nothing else. */
export function linkedRunEntries(row: Pick<QueueSurfaceWire, "parent" | "linkedRuns">): readonly LinkedRunEntry[] {
  const entry = (target: LinkedRunWire, relation: LinkedRunEntry["relation"], name: string): LinkedRunEntry =>
    ({ name, workflow: target.label, status: statusText(dsStatusOf(target.status)), relation, target });
  return [...row.parent === null ? [] : [entry(row.parent, "Parent", row.parent.title)], ...row.linkedRuns.map(link => entry(link, "Child", link.label))];
}
