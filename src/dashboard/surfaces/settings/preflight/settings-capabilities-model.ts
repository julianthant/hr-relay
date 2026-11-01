import {
type WorkflowCapabilityRowWire
} from "../../../../models/dashboard/settings.js";


export type CapabilityKey =
  | "dry-run"
  | "typed-start"
  | "review-panel"
  | "edit-data"
  | "operator-gates"
  | "browser-systems";


export interface CapabilitySpec {
  readonly key: CapabilityKey;
  readonly label: string;
  /** what the capability means, in the operator's words — lives behind the ⓘ */
  readonly meaning: string;
}


/** The SERVED vocabulary, in the order the page reads it: what starts it, what
 * it will and will not write, then what it touches and who has to be there. */
export const CAPABILITY_SPECS: readonly CapabilitySpec[] = Object.freeze([
  {
    key: "typed-start",
    label: "Typed start",
    meaning: "Whether you can start this by typing subjects into the Run modal. A workflow without one is started as a step of the composition that owns it.",
  },
  {
    key: "dry-run",
    label: "Dry run",
    meaning: "Previews each applicable stage without submitting. Sample values are labelled and unavailable stages stay visible. A workflow that changes no system of record uses Live read.",
  },
  {
    key: "edit-data",
    label: "Edit Data",
    meaning: "Which checkpoint values you may correct from the Context rail. The descriptor names the exact paths; anything it does not name is read-only.",
  },
  {
    key: "review-panel",
    label: "Review panel",
    meaning: "Its rows get a Review panel of their own rather than being read from the queue.",
  },
  {
    key: "operator-gates",
    label: "Operator gates",
    meaning: "The points where a run parks and waits for you. A gate resolved by another system or by its own children is not your work and is not listed.",
  },
  {
    key: "browser-systems",
    label: "Systems",
    meaning: "The systems a run signs into and drives. Every one of them needs an authenticated session before the run can move.",
  },
]);


/** ONE cell. */
export type CapabilityCell =
  | { readonly state: "available"; readonly detail: string }
  | { readonly state: "not-applicable"; readonly reason: string }
  | { readonly state: "not-built"; readonly reason: string };


export interface CapabilityRow {
  readonly workflowId: string;
  /** the bootstrap's label */
  readonly label: string;
  readonly labelServed: boolean;
  readonly cells: Readonly<Record<CapabilityKey, CapabilityCell>>;
  /** SE41's posture table reads the same served arm this row's `dry-run` cell does */
  readonly dryRunPosture: string;
}


function dryRunCell(row: WorkflowCapabilityRowWire): CapabilityCell {
  if (row.dryRun.state === "supported") {
    return { state: "available", detail: "traverses all applicable stages" };
  }
  if (row.dryRun.reason === "no-transaction-node") {
    return { state: "not-applicable", reason: "writes to no system of record" };
  }
  return { state: "not-built", reason: `${String(row.dryRun.nodeId)} declares no preview arm` };
}


/** Distinguish preview support, no transactions and preview refusal before offering a real write. */
export function dryRunPostureSentence(row: WorkflowCapabilityRowWire): string {
  if (row.dryRun.state === "supported") {
    return "Reads, fills, verifies and captures each applicable stage without submitting; sample values are labelled dry-run sample.";
  }
  if (row.dryRun.reason === "no-transaction-node") {
    return "Nothing to stop at: this graph commits to no system of record, so a rehearsal of it is an ordinary run.";
  }
  return `Refused: ${String(row.dryRun.nodeId)} commits and declares no preview arm, so a rehearsal cannot reach the end.`;
}


function editDataCell(row: WorkflowCapabilityRowWire): CapabilityCell {
  if (row.editData.state === "read-only") {
    return { state: "not-applicable", reason: "no correctable path is declared" };
  }
  if (row.editData.editableFields === 0) {
    return { state: "not-applicable", reason: "declared, and no path is correctable" };
  }
  const count = row.editData.editableFields;
  return { state: "available", detail: `${String(count)} correctable field${count === 1 ? "" : "s"}` };
}


/** Use bootstrap labels; missing labels retain real workflow IDs and disclose their absent provenance. */
export function capabilityMatrix(
  rows: readonly WorkflowCapabilityRowWire[],
  labels: ReadonlyMap<string, string>,
): readonly CapabilityRow[] {
  return rows.map((row) => {
    const id = String(row.workflowId);
    const served = labels.get(id);
    const gates = row.operatorGates.map((gate) => String(gate));
    const systems = row.browserSystems.map((system) => String(system));
    return Object.freeze({
      workflowId: id,
      label: served ?? id,
      labelServed: served !== undefined,
      dryRunPosture: dryRunPostureSentence(row),
      cells: Object.freeze({
        "typed-start": row.typedStart
          ? { state: "available" as const, detail: "typed input" }
          : { state: "not-applicable" as const, reason: "no typed start surface is declared" },
        "dry-run": dryRunCell(row),
        "edit-data": editDataCell(row),
        "review-panel": row.reviewPanel
          ? { state: "available" as const, detail: "Review panel" }
          : { state: "not-applicable" as const, reason: "read from the queue" },
        "operator-gates": gates.length > 0
          ? { state: "available" as const, detail: gates.join(", ") }
          : { state: "not-applicable" as const, reason: "parks on no operator gate" },
        "browser-systems": systems.length > 0
          ? { state: "available" as const, detail: systems.join(", ") }
          : { state: "not-applicable" as const, reason: "drives no browser system" },
      }),
    });
  });
}


/** `N of M` per capability — how many workflows answer it at all. */
export function capabilityAvailableCount(
  matrix: readonly CapabilityRow[],
  key: CapabilityKey,
): number {
  return matrix.filter((row) => row.cells[key].state === "available").length;
}
