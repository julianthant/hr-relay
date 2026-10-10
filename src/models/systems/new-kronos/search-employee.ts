/** ONE visit to the WFD Employee Search results panel, returning the whole useful surface; every non-resolved outcome is a distinct FAILURE, never one combined negative. */
import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { NewKronosSearchCandidateSchema } from "../../ui/new-kronos-timecard.js";
import { defineTaskContract } from "../../task/task-contract.js";

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
    /* Which context rendered the panel, recorded because it is a real, observed property of the visit. */
  panelContext: z.enum(["portal-frame", "top-level"]),
});
export type SearchEmployeeOutput = z.infer<typeof SearchEmployeeOutputSchema>;

export const NewKronosSearchEmployee = defineTaskContract({
  id: taskId("new-kronos/search-employee"),
  title: "Search New Kronos For Employee",
  effect: "read",
  input: z.strictObject({
    emplId: EidSchema,
        /* How long a search may go without answering EITHER WAY before the run refuses: the line past which silence becomes its own reported outcome. */
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
    /* The results panel displays CANDIDATES, not a bound subject — the person the run is about is proved one page later, on the timecard's own identity header. */
  subject: {
    kind: "none",
    reason:
      "the Employee Search results panel renders a candidate list; the subject is proved on the timecard's own displayed-eid observation (S37)",
  },
    /* `Infinity` is ARGUED: separations takes no automatic freshness refresh, and a stale but successfully read checkpoint may be confirmed by explicit operator action. */
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
