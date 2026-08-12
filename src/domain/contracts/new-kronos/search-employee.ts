/**
 * `new-kronos/search-employee` — ONE visit to the WFD Employee Search results
 * panel (D194 / doc 01 §2.8).
 *
 * The output is the whole useful surface of that page, not the one field this
 * workflow needs: WFD's own `Total [N]` counter, EVERY candidate row it
 * rendered with the name and id the row itself carries, the row that matched
 * the queried EID, the `Selected [N]` counter that proves the pick registered,
 * and which of the two render contexts served the panel. A later migration
 * wanting "who else did that name match" writes a fold, not a second search.
 *
 * ## Why every non-resolved outcome is a distinct FAILURE
 *
 * `separations.md` §4b is explicit: an unreachable Kronos, a failed search, or
 * a timecard that will not open **fails the run** — no fallback to the
 * Kuali-carried dates. It is equally explicit that the outcomes stay distinct
 * values in the data model, "because the day the operator flags a real special
 * case, those are the values the new composition will be selected on". A failed
 * run's durable distinct value is its `FailureRecord.code`, so the three
 * negatives are three error codes and never one:
 *
 *  - `employee-not-found` — WFD rendered its own `There are no items to
 *    display.` sentinel. A REAL negative (S34).
 *  - `search-returned-no-match` — rows rendered, but none of them is this
 *    person. The failure message names who WAS offered.
 *  - `search-no-signal` — neither surfaced inside the bound. "The check could
 *    not run" (S35 / pattern D5), and the single thing legacy gets most wrong
 *    here: it logs a warning and returns `found:false`, which downstream is
 *    indistinguishable from "this person is not timekept at all".
 */
import { z } from "zod";
import { EidSchema, taskId } from "../../ids.js";
import { NewKronosSearchCandidateSchema } from "../../ui/new-kronos-timecard.js";
import { defineTaskContract } from "../base.js";

export const SearchEmployeeOutputSchema = z.strictObject({
  /** The exact string submitted to WFD's search box. */
  query: z.string().min(1),
  /** WFD's own `Total [N]` counter for this result set. */
  totalCount: z.number().int().positive(),
  /** Every rendered row, in render order, off each row's own accessible name. */
  candidates: z.array(NewKronosSearchCandidateSchema).min(1),
  /** The row whose employee id equals the queried EID. */
  matched: NewKronosSearchCandidateSchema,
  /** WFD's `Selected [N]` counter after the pick — the Go To enable proof. */
  selectedCount: z.number().int().positive(),
  /**
   * Which context rendered the panel. Recorded because it is a real, observed
   * property of the visit: a fresh home load puts the panel inside
   * `portal-frame-*`, and a post-timecard visit renders it top-level.
   */
  panelContext: z.enum(["portal-frame", "top-level"]),
});
export type SearchEmployeeOutput = z.infer<typeof SearchEmployeeOutputSchema>;

export const NewKronosSearchEmployee = defineTaskContract({
  id: taskId("new-kronos/search-employee"),
  title: "Search New Kronos For Employee",
  effect: "read",
  input: z.strictObject({
    emplId: EidSchema,
    /**
     * How long a search may go without answering EITHER WAY before the run
     * refuses. The live sentinel surfaced in 548ms, so this is not a "give the
     * grid a chance" allowance — it is the line past which silence becomes its
     * own reported outcome instead of a fabricated negative.
     */
    searchTimeoutMs: z.number().int().positive().max(120_000),
  }),
  output: SearchEmployeeOutputSchema,
  errorCodes: [
    "new-kronos-unavailable",
    "unexpected-page-state",
    "employee-not-found",
    "search-returned-no-match",
    "search-no-signal",
  ],
  /**
   * The results panel displays CANDIDATES, not a bound subject — the person the
   * run is about is proved one page later, on the timecard's own
   * `.emp-nav-id` header, which is the S37 wrong-person control. Binding a
   * subject to a list would claim a proof this page cannot give.
   */
  subject: {
    kind: "none",
    reason:
      "the Employee Search results panel renders a candidate list; the subject is proved on the timecard's own displayed-eid observation (S37)",
  },
  /**
   * `Infinity` is ARGUED, per separations §5 residual 5A (operator, 2026-08-12):
   * separations takes no automatic freshness refresh. Refresh here is a
   * deliberate operator re-run, never an age check silently re-searching
   * mid-run. `audited` per 5B: a stale but successfully read checkpoint may be
   * confirmed by explicit operator action, which is not a fallback path.
   */
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "audited" },
  provenance: { default: "live" },
  scenarios: [
    "separations-kronos-timecard/reads-a-real-timecard",
    "separations-kronos-timecard/employee-not-found",
    "separations-kronos-timecard/search-no-signal",
  ],
  example: {
    query: "10776990",
    totalCount: 1,
    candidates: [{ displayName: "Kou, Nathan", employeeId: "10776990" }],
    matched: { displayName: "Kou, Nathan", employeeId: "10776990" },
    selectedCount: 1,
    panelContext: "portal-frame",
  },
});
