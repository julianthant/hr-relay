import {
type WorkflowCapabilityRowWire
} from "../../models/dashboard/settings.js";


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


/**
 * The SERVED vocabulary, in the order the page reads it: what starts it, what
 * it will and will not write, then what it touches and who has to be there.
 *
 * Six, not the demo's sixteen. D274 item 4's rule for exactly this case is to
 * build the vocabulary the product actually serves and NAME the absence rather
 * than mint a column with nothing behind it — a matrix that claims a capability
 * no descriptor declares is wrong silently, which is the worst way to be wrong
 * on a page whose whole job is to say what is true.
 */
export const CAPABILITY_SPECS: readonly CapabilitySpec[] = Object.freeze([
  {
    key: "typed-start",
    label: "Typed start",
    meaning: "Whether you can start this by typing subjects into the Run modal. A workflow without one is started as a step of the composition that owns it.",
  },
  {
    key: "dry-run",
    label: "Dry run",
    meaning: "Offers a rehearsal that reads everything for real and writes nothing. A workflow that changes no system of record has nothing to rehearse.",
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


/**
 * ONE cell. Three shapes, told apart by SHAPE and by WORD, never by colour:
 * available carries the thing itself, `not-applicable` carries the decision, and
 * `not-built` carries the gap with its named offender. Collapsing the last two
 * into one grey dash is how "we chose not to" and "we have not got to it" become
 * indistinguishable, and an operator plans differently depending on which it is.
 */
export type CapabilityCell =
  | { readonly state: "available"; readonly detail: string }
  | { readonly state: "not-applicable"; readonly reason: string }
  | { readonly state: "not-built"; readonly reason: string };


export interface CapabilityRow {
  readonly workflowId: string;
  /** the bootstrap's label, or the id itself when this document does not list it */
  readonly label: string;
  readonly labelServed: boolean;
  readonly cells: Readonly<Record<CapabilityKey, CapabilityCell>>;
  /** SE41's posture table reads the same served arm this row's `dry-run` cell does */
  readonly dryRunPosture: string;
}


function dryRunCell(row: WorkflowCapabilityRowWire): CapabilityCell {
  if (row.dryRun.state === "supported") {
    return { state: "available", detail: `stops at ${String(row.dryRun.stopsAt)}` };
  }
  if (row.dryRun.reason === "no-transaction-node") {
    return { state: "not-applicable", reason: "writes to no system of record" };
  }
  return { state: "not-built", reason: `${String(row.dryRun.nodeId)} declares no preview arm` };
}


/**
 * The one fact that is NOT a yes/no, so it also gets its own table: a workflow
 * can honour a rehearsal, have nothing to rehearse, or write and refuse one —
 * and the third is the answer worth reading before a real HR transaction.
 */
export function dryRunPostureSentence(row: WorkflowCapabilityRowWire): string {
  if (row.dryRun.state === "supported") {
    return `Stops after the prepare of ${String(row.dryRun.stopsAt)} — nothing is committed.`;
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


/**
 * The served rows, joined to the bootstrap's labels.
 *
 * The label is the BOOTSTRAP's — the capability wire deliberately carries none,
 * so one page cannot hold two names for one workflow. A row this document does
 * not list falls back to the workflow's own id, which is its identity and not an
 * invented name, and says so through `labelServed` rather than reading as a
 * badly-cased label.
 */
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
