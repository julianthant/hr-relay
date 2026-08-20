/**
 * The Explorer's pure reads over the served workflow wire — graph totals, the dry-run posture, node bindings and edge lookups.
 *
 * It lives beside `explorer.tsx` rather than inside it because a module that exports
 * a component may export nothing else if React Fast Refresh is to treat it as a
 * refresh boundary: one non-component export makes every edit to the surface
 * invalidate upward into `dashboard-app.tsx` and remount the app instead of
 * hot-swapping the component. Same values, same call sites, one import hop.
 */


import type {
  ExplorerContractFieldWire,
  ExplorerNodeWire,
  ExplorerTaskWire,
  ExplorerWorkflowWire,
} from "../../domain/dashboard/explorer.js";





/* ── pure derivations, exported so the tests read the same rules ─────────── */

/**
 * A freshness bound, in the units a person reads it in.
 *
 * `10002992` is a number an operator has to do arithmetic on before it means
 * anything, and the arithmetic is where they get it wrong. The exact value
 * stays reachable on the chip's title, because a contract review needs the
 * millisecond and a glance needs the hour.
 */
export function fmtFreshness(limit: number | "unbounded"): string {
  if (limit === "unbounded") return "unbounded";
  if (limit === 0) return "always fresh";
  const seconds = limit / 1000;
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${String(Math.round(minutes))}m`;
  const hours = minutes / 60;
  return hours < 24 ? `${String(Math.round(hours))}h` : `${String(Math.round(hours / 24))}d`;
}

/**
 * The demo's `contractTotals`, now a real FIELD census (D227).
 *
 * A read is one field a read arm observes FROM a system — its output leaves. A
 * write is one field a commit arm writes TO a system — its input leaves. The
 * prepare arm's inputs are deliberately not counted: it stages the same values
 * its commit then writes, so counting both would report every write twice.
 *
 * The demo's third segment (`1 file`) stays absent: it is a per-run artifact
 * count, and ref operator-trust §5.7 already dispositioned it as a run fact rather than a
 * registry one.
 */
export function explorerGraphTotals(
  workflow: ExplorerWorkflowWire,
): Readonly<{ nodes: number; reads: number; writes: number }> {
  let reads = 0;
  let writes = 0;
  for (const node of workflow.nodes) {
    for (const task of node.tasks) {
      for (const field of task.fields) {
        if (task.effect === "read" && field.side === "output") reads += 1;
        if (task.effect === "commit" && field.side === "input") writes += 1;
      }
    }
  }
  return { nodes: workflow.nodes.length, reads, writes };
}

/**
 * The system a task arm binds to, as the contract table's middle column.
 *
 * A browser store names its driver's system; a headless store has none, so its
 * namespace is the honest answer to "where does this run" — and an unbound
 * contract says `unbound` rather than borrowing the workflow's system.
 */
export function taskSystemLabel(task: ExplorerTaskWire): string {
  if (task.binding.state !== "bound") return "unbound";
  return task.binding.driverSystem ?? task.binding.storeNamespace;
}

/** One field row's second line: which side it sits on, and what it holds. */
export function fieldShapeLine(field: ExplorerContractFieldWire): string {
  const side = field.side === "input" ? "in" : "out";
  const presence = field.presence === "sometimes" ? " · sometimes" : "";
  return `${side} · ${field.kind}${presence}`;
}

export type DryRunPosture = "boundary" | "no-rehearsal" | "no-system-write";

/**
 * The demo's three answers to "where does it write, and can I rehearse it?",
 * derived from each transaction node's OWN declared `dryRun` policy.
 *
 * They are not degrees of each other: a boundary a dry run stops at, a write
 * with no rehearsal at all, and a workflow that changes no system of record.
 * The third is served as a FACT — a graph with no transaction node — and never
 * inferred from a boundary line that did not get drawn.
 */
export function dryRunPosture(workflow: ExplorerWorkflowWire): DryRunPosture {
  const transactions = workflow.nodes.filter((node) => node.shape.kind === "transaction");
  if (transactions.length === 0) return "no-system-write";
  const unsupported = transactions.some(
    (node) => node.shape.kind === "transaction" && node.shape.dryRun === "unsupported",
  );
  return unsupported ? "no-rehearsal" : "boundary";
}

/**
 * The node a dry run stops at — the FIRST transaction node in declaration
 * order, when every transaction node honours `stop-after-prepare`.
 *
 * `undefined` is a real answer twice over: a graph with no transaction node has
 * nothing to stop short of, and a graph carrying an `unsupported` transaction
 * has no rehearsal at all. Neither may be drawn as a line, because a line in
 * either case would claim a safety boundary that does not exist.
 */
export function dryRunBoundaryNodeId(workflow: ExplorerWorkflowWire): string | undefined {
  if (dryRunPosture(workflow) !== "boundary") return undefined;
  const first = workflow.nodes.find((node) => node.shape.kind === "transaction");
  return first === undefined ? undefined : String(first.id);
}

/** one chip's worth of "where this node runs", read off a task binding */
export interface NodeBinding {
  /** `system` is a browser driver's real system; `store` is a headless namespace */
  readonly label: "system" | "store";
  readonly value: string;
}

/**
 * Where a node runs, read off its own task bindings.
 *
 * A browser store declares its driver's SYSTEM (`ucpath`, `kuali`) and that is
 * the word the demo puts on the chip. A headless store owns no system, so what
 * names it is its namespace (`workflow:separations`) — and it is labelled
 * `store` rather than `system`, because calling a workflow's own mini-store a
 * "system" would put it in the same sentence as UCPath. A control node (branch,
 * parallel, gate) binds no contract at all and gets no chip, exactly as the demo
 * omits one for a node whose `system` is absent.
 */
export function nodeBindings(node: ExplorerNodeWire): readonly NodeBinding[] {
  const bindings: NodeBinding[] = [];
  for (const task of node.tasks) {
    if (task.binding.state !== "bound") continue;
    const binding: NodeBinding = task.binding.driverSystem === undefined
      ? { label: "store", value: task.binding.storeNamespace }
      : { label: "system", value: task.binding.driverSystem };
    if (!bindings.some((one) => one.label === binding.label && one.value === binding.value)) {
      bindings.push(binding);
    }
  }
  return bindings;
}

/**
 * The node's human label, dropped when it only restates the id.
 *
 * The demo prints ONE name per row because its node ids are already prose. Here
 * `crm-dates` and `CRM Dates` are the same word twice, and a row that prints
 * both teaches the reader that the second column carries nothing. It is kept
 * wherever it genuinely says more (`job-summary` · `Job Summary` collapses;
 * `annotate-timekeeper` · `Kuali Timekeeper Annotation` does not).
 */
export function nodeLabelBeside(node: ExplorerNodeWire): string | undefined {
  const normalized = node.label.toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  return normalized === String(node.id).toLowerCase() ? undefined : node.label;
}

/** the systems a transaction node in this graph writes to, for the hazard banner */
export function writeSystems(workflow: ExplorerWorkflowWire): readonly string[] {
  const systems: string[] = [];
  for (const node of workflow.nodes) {
    if (node.shape.kind !== "transaction") continue;
    for (const binding of nodeBindings(node)) {
      if (!systems.includes(binding.value)) systems.push(binding.value);
    }
  }
  return systems;
}

/**
 * The conditional edges leaving one node — the demo's `Connector`.
 *
 * `depends-on` is the execution edge every node declares and it is drawn as the
 * demo draws it: the word `always`. A `branch-case` or `parallel-branch` edge
 * is a CHOICE the controller makes, so it is named with the case or branch the
 * descriptor gave it. The closure that decides between them stays source-only
 * (§5.7) — the surface reports the choice's NAME, never a rendering of what the
 * function computes.
 */
export function conditionalEdgesFrom(
  workflow: ExplorerWorkflowWire,
  fromId: string,
): readonly Readonly<{ to: string; condition: string }>[] {
  return workflow.edges
    .filter((edge) => String(edge.from) === fromId && edge.kind !== "depends-on")
    .map((edge) => ({
      to: String(edge.to),
      condition: edge.label === undefined
        ? (edge.kind === "branch-case" ? "a case of this branch" : "a branch of this parallel")
        : `${edge.kind === "branch-case" ? "case" : "branch"} ${edge.label}`,
    }));
}

/**
 * Does the graph declare that `toId` runs AFTER `fromId`?
 *
 * The demo prints `always` between every pair of same-lane rows because its
 * corpus links them all. This registry does not: three of `separations`' 17
 * consecutive pairs have no edge at all — `termination-type` does not depend on
 * `plan`, they merely happen to be declared next to each other. Printing
 * `always` there would state a dependency the descriptor never declared, which
 * is the surface inventing an edge.
 */
export function dependsOnEdgeExists(
  workflow: ExplorerWorkflowWire,
  fromId: string,
  toId: string,
): boolean {
  return workflow.edges.some(
    (edge) => edge.kind === "depends-on" && String(edge.from) === fromId && String(edge.to) === toId,
  );
}
