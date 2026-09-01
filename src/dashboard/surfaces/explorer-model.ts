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
  ExplorerEditDraft,
  ExplorerEditValidationResult,
  ExplorerNodeWire,
  ExplorerProposedWorkflowOverride,
  ExplorerTaskWire,
  ExplorerWorkflowWire,
  SourceLinkWire,
} from "../../domain/dashboard/explorer.js";
import type { CommandResult } from "../../domain/commands.js";

/** The three presentation rows DCC5 may edit; everything else is inspection-only. */
export type ExplorerPresentationField = "workflow-label" | "workflow-icon" | "workflow-category";

const PRESENTATION_FIELD_LABEL: Readonly<Record<ExplorerPresentationField, string>> = {
  "workflow-label": "Workflow label",
  "workflow-icon": "Workflow icon",
  "workflow-category": "Workflow category",
};

/**
 * The full name of the field, and the one the EDIT DOOR is named after.
 *
 * The door's accessible name is `Edit workflow category` and it stays that
 * whatever the row prints (ref operator-trust §5.4, D283): the door is the
 * thing a keyboard user arrives at with no section around it, so the word
 * `workflow` has to be in the name itself.
 */
export function explorerPresentationFieldLabel(field: ExplorerPresentationField): string {
  return PRESENTATION_FIELD_LABEL[field];
}

const PRESENTATION_FIELD_SHORT_LABEL: Readonly<Record<ExplorerPresentationField, string>> = {
  "workflow-label": "Label",
  "workflow-icon": "Icon",
  "workflow-category": "Category",
};

/**
 * What the field is CALLED inside the Presentation row (D299).
 *
 * Three fields whose every name began `Workflow ` sat in a section headed
 * `Presentation`, inside a panel headed `Person Lookup v1`, each beside a
 * button that said `Edit workflow label` — the word `workflow` four times in
 * one row, in a region whose whole job is three short values. The row drops
 * the qualifier it is already standing inside; the door keeps it, because a
 * door is read out of context.
 */
export function explorerPresentationFieldShortLabel(field: ExplorerPresentationField): string {
  return PRESENTATION_FIELD_SHORT_LABEL[field];
}

/**
 * The served starting value for one presentation editor.
 *
 * This is intentionally a model fold rather than an effect-written default:
 * React effects run after the dialog's first render, so an icon/category
 * editor must already hold a served allowlisted value while that render builds
 * its strict change object.
 */
export function explorerPresentationValue(
  workflow: ExplorerWorkflowWire,
  field: ExplorerPresentationField,
): string {
  switch (field) {
    case "workflow-label": return workflow.label;
    case "workflow-icon": return workflow.icon;
    case "workflow-category": return workflow.category;
  }
}

/**
 * One strict presentation change. Icon and category are re-selected from the
 * served inventory, never cast from a browser-controlled string.
 */
export function explorerPresentationChange(
  workflow: ExplorerWorkflowWire,
  field: ExplorerPresentationField,
  value: string,
): ExplorerEditDraft["changes"][number] {
  switch (field) {
    case "workflow-label": return { kind: field, value };
    case "workflow-icon": {
      const icon = workflow.edit.presentation.iconValues.find((option) => option === value);
      if (icon === undefined) throw new Error(`Explorer did not serve icon ${value} as editable`);
      return { kind: field, value: icon };
    }
    case "workflow-category": {
      const category = workflow.edit.presentation.categoryValues.find((option) => option === value);
      if (category === undefined) throw new Error(`Explorer did not serve category ${value} as editable`);
      return { kind: field, value: category };
    }
  }
}

/**
 * A validation response belongs to one editor generation and to every stable
 * command input known before dispatch. This prevents a late ready response
 * from being applied to another target, value, reason, or operator.
 */
export interface ExplorerEditValidationTicket {
  readonly generation: number;
  readonly identity: string;
}

/** A client-side edit outcome whose wording must not overstate command truth. */
export interface ExplorerEditProblem {
  readonly kind: "validation" | "not-applied" | "result-unknown" | "applied-but-unverified";
  readonly message: string;
  readonly commandId?: string;
}

export function explorerEditProblemTitle(problem: ExplorerEditProblem): string {
  switch (problem.kind) {
    case "validation": return "Explorer draft could not be reviewed";
    case "not-applied": return "Explorer edit was not applied";
    case "result-unknown": return "Explorer edit result is unknown";
    case "applied-but-unverified": return "Explorer edit applied but unverified";
  }
}

function reviewIdentity(draft: ExplorerEditDraft, reason: string, actorId: string | undefined): string {
  return JSON.stringify({ draft, reason, actorId });
}

export function makeExplorerEditValidationTicket(
  generation: number,
  draft: ExplorerEditDraft,
  reason: string,
  actorId: string | undefined = undefined,
): ExplorerEditValidationTicket {
  return Object.freeze({ generation, identity: reviewIdentity(draft, reason, actorId) });
}

export function acceptsExplorerEditValidationTicket(
  ticket: ExplorerEditValidationTicket,
  generation: number,
  draft: ExplorerEditDraft,
  reason: string,
  actorId: string | undefined = undefined,
): boolean {
  return ticket.generation === generation && ticket.identity === reviewIdentity(draft, reason, actorId);
}

/** Exact structural equality for one strict draft, including every CAS basis. */
export function sameExplorerEditDraft(left: ExplorerEditDraft, right: ExplorerEditDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A ready validation may enable apply only for the exact requested target and bases. */
export function matchesExplorerValidationDraft(
  result: ExplorerEditValidationResult,
  requested: ExplorerEditDraft,
): boolean {
  if (result.state !== "ready-to-apply" || !sameExplorerEditDraft(result.draft, requested)) return false;
  return String(result.override.workflowId) === String(requested.workflowId)
    && result.override.descriptorVersion === requested.baseDescriptorVersion
    && result.override.contractFingerprint === requested.baseContractFingerprint;
}

/**
 * A successful generic command result must acknowledge THIS generated command
 * and exactly the Explorer target/revision it was asked to advance.
 */
export function matchesExplorerApplyAcknowledgement(
  result: Extract<CommandResult, { state: "applied" | "already-applied" }>,
  commandId: string,
  workflowId: string,
  revision: number,
): boolean {
  return result.commandId === commandId
    && result.affectedTargets.length === 1
    && result.affectedTargets[0]?.family === "explorer"
    && String(result.affectedTargets[0].workflowId) === workflowId
    && result.affectedTargets[0].revision === revision;
}

/**
 * Every command-result arm is meaningful only when it belongs to this exact
 * generated command. A foreign conflict or refusal is not proof that this
 * draft was not applied; it is an unknown result which must remain blocking.
 */
export function matchesExplorerCommandResultId(result: CommandResult, commandId: string): boolean {
  return result.commandId === commandId;
}

/**
 * The post-command projection is the actual success proof. Every reviewed
 * presentation value, descriptor basis and override revision must match;
 * otherwise the command may have landed but this dialog is unverified.
 */
export function matchesExplorerAppliedReadback(
  before: ExplorerWorkflowWire,
  draft: ExplorerEditDraft,
  reviewed: ExplorerProposedWorkflowOverride,
  readback: ExplorerWorkflowWire | undefined,
): readback is ExplorerWorkflowWire {
  if (readback === undefined) return false;
  const expected = reviewed.presentation;
  return String(readback.id) === String(draft.workflowId)
    && readback.version === draft.baseDescriptorVersion
    && readback.contractFingerprint === draft.baseContractFingerprint
    && readback.edit.overrideRevision === reviewed.revision
    && readback.label === (expected.label ?? before.label)
    && readback.icon === (expected.icon ?? before.icon)
    && readback.category === (expected.category ?? before.category);
}

/**
 * The one draft shape the Explorer UI can author. It is deliberately derived
 * from the served workflow identity: the client never receives a free-form
 * fingerprint, descriptor version, or override revision control.
 */
export function explorerPresentationDraft(
  workflow: ExplorerWorkflowWire,
  change: ExplorerEditDraft["changes"][number],
): ExplorerEditDraft {
  return {
    draftVersion: 1,
    workflowId: workflow.id,
    baseDescriptorVersion: workflow.version,
    baseContractFingerprint: workflow.contractFingerprint,
    baseOverrideRevision: workflow.edit.overrideRevision,
    changes: [change],
  };
}





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

/**
 * How one scenario's walking file is PRINTED in the Scenarios table (D299).
 *
 * A resolved file prints its base name. Every row of that table names a file
 * under the same scenario tree, so the directory was the half of the path that
 * repeated verbatim down the column while the half that told the rows apart —
 * `person-lookup` vs `person-lookup-runtime` — sat at the far right of a
 * chip. The whole path stays on the cell's `title`, and the column is a real
 * table column, so a reader who wants it has one hover rather than seven
 * repetitions.
 *
 * A MISS prints the whole attempted path and never trims it. The reader's next
 * move depends on where the explorer looked, and a base name that resolves to
 * nothing is the plausible-but-absent value ref operator-trust forbids — so the
 * arm that is an ANSWER is short and the arm that is a FAILURE is complete.
 */
export interface ScenarioSourceCell {
  readonly state: SourceLinkWire["state"];
  /** what the cell prints */
  readonly text: string;
  /** the whole fact, for the cell's hover */
  readonly title: string;
}

export function scenarioSourceCell(link: SourceLinkWire): ScenarioSourceCell {
  if (link.state === "resolved") {
    const path = String(link.path);
    return { state: "resolved", text: path.slice(path.lastIndexOf("/") + 1), title: path };
  }
  return {
    state: "unresolved",
    text: `unresolved: ${String(link.attemptedPath)}`,
    title: `${String(link.attemptedPath)} — ${link.reason}`,
  };
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

/* ── the Edit Data allowlist, resolved onto contract rows ────────────────── */

/**
 * The key a correctable mark is looked up by: the field's SIDE and its path.
 *
 * `editableFields` carries a path and no side, and the contract table draws one
 * row per `side:path` — so keying the marks by path alone lets an OUTPUT path
 * that happens to spell the same string as an INPUT path on the same node
 * pencil the input row too, claiming the operator may correct a value the node
 * READ. Nothing upstream forbids the collision (`nodeId + fieldPath` is all the
 * kernel's save check matches on), so the surface has to be the side that knows.
 */
function markKey(side: ExplorerContractFieldWire["side"], path: string): string {
  return `${side} ${path}`;
}

/**
 * `side path` -> the Edit Data label the descriptor allowlists it under.
 *
 * OUTPUT only. ref data-intake-and-edit-data §6.3: an edit is re-parsed against
 * "the producing contract's full output schema", so an allowlisted path is by
 * construction a value the node WROTE, and an input row can never take the mark.
 */
export function correctableMarks(node: ExplorerNodeWire): ReadonlyMap<string, string> {
  return new Map(
    node.editableFields.map((field) => [markKey("output", String(field.fieldPath)), field.label]),
  );
}

/** The mark one drawn contract row takes, or `undefined` when it takes none. */
export function correctableMarkFor(
  marks: ReadonlyMap<string, string>,
  field: ExplorerContractFieldWire,
): string | undefined {
  return marks.get(markKey(field.side, String(field.path)));
}

/**
 * Allowlisted paths with no OUTPUT contract row to sit on.
 *
 * They cannot be dropped: the point of moving the mark onto the field row (D275
 * item 6) is that the row is where the fact is read, so a path this node exports
 * for Edit Data that no output arm of it declares is a descriptor defect the
 * surface must say out loud rather than render as "nothing is correctable here".
 * An input-only path lands here too, and that is the point — §6.3 re-parses an
 * edit against the output schema, so such a save is refused by a rule this page
 * would otherwise have hidden behind a pencil.
 */
export function unplaceableEditableFields(
  node: ExplorerNodeWire,
): readonly ExplorerNodeWire["editableFields"][number][] {
  const outputs = new Set(
    node.tasks.flatMap((task) =>
      task.fields.filter((field) => field.side === "output").map((field) => String(field.path)),
    ),
  );
  return node.editableFields.filter((field) => !outputs.has(String(field.fieldPath)));
}
