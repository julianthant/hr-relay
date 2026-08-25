/**
 * D265 §1.2.2 rule 2 — the *Kronos timecard* step's node fragments: the New
 * Kronos employee search that leaves the subject SELECTED, the timecard read
 * over the separation window, and the pure date reconciliation over it.
 *
 * A fragment owns a node's IDENTITY — id, contract, label, replay — and takes
 * its WIRING (`dependsOn` + `bind`) from the graph that applies it (see
 * `src/base/flow.ts`, "node fragments"). The harness in this folder applies
 * `timecard` from its own ingress; its search node is `search` / "Employee
 * Search" — a different id and label, so a different node identity — and stays
 * hand-written there rather than being passed off as this step's
 * `timecard-search`.
 */
import { defineWorkflowStepNodeFactory } from "../../../base/flow.js";
import { NewKronosReadSeparationTimecard } from "../../../domain/contracts/new-kronos/read-separation-timecard.js";
import { NewKronosSearchEmployee } from "../../../domain/contracts/new-kronos/search-employee.js";
import { SeparationsReadSeparationDates } from "../../../domain/contracts/separations/read-separation-dates.js";
import { KRONOS_TIMECARD_STEP } from "./step.js";

export const TIMECARD_SEARCH_NODE = "timecard-search";
export const TIMECARD_NODE = "timecard";
export const DATES_NODE = "dates";

const nodes = defineWorkflowStepNodeFactory(KRONOS_TIMECARD_STEP);

/**
 * `always-rerun`, and chunk 1 paid for the rule live (`sk-124132-9beb`): the
 * search's OUTPUT is durable but its POINT is a side effect that is not — it
 * leaves the employee selected in the WFD panel, which is the only thing that
 * enables Go To. **A node whose real product is BROWSER state may not be
 * `replay: "checkpoint"`.**
 *
 * The composition pays a real cost for that: a gate resume re-runs this node
 * (the timecard replays from its checkpoint, so nothing consumes the panel),
 * which is one New Kronos session per gated run. The alternative is a
 * checkpoint that restores a selection into a browser that never made one, and
 * that is the failure chunk 1 already recorded.
 */
export const timecardSearchNode = nodes.task(TIMECARD_SEARCH_NODE, NewKronosSearchEmployee, {
  label: "Timecard Search",
  replay: "always-rerun",
});

/**
 * The timecard visit begins from the selection the search node left in the
 * panel, so every graph that applies it depends on that search structurally as
 * well as semantically, and its bind reads the search's own `matched` fact
 * through `requireFact` — Go To is disabled without the selection, and a
 * disabled Go To is a loud failure, never an empty card.
 */
export const timecardNode = nodes.task(TIMECARD_NODE, NewKronosReadSeparationTimecard, {
  label: "Timecard",
  replay: "checkpoint",
});

export const datesNode = nodes.task(DATES_NODE, SeparationsReadSeparationDates, {
  label: "Reconciled Dates",
  replay: "checkpoint",
});

/** The step's timeline category — key and label from `step.ts`, nodes from the fragments above. */
export const KRONOS_TIMECARD_STEP_NODES = nodes.category([
  timecardSearchNode,
  timecardNode,
  datesNode,
]);
