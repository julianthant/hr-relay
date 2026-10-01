import { defineTask } from "../../../base/task.js";
import {
  NewKronosSearchEmployee,
  SearchEmployeeOutputSchema,
} from "../../../domain/contracts/new-kronos/search-employee.js";
import { directIdentifierDisplay } from "../../../domain/redaction.js";
import { newKronosDriver } from "../declaration.js";

/**
 * Ported semantic operation: legacy 1bffbd65,
 * `src/systems/new-kronos/navigate.ts` (`searchEmployee` :214-286,
 * `waitForEmployeeSearchOutcome` :142-178, `selectEmployeeResult` :323-386).
 *
 * The three negative outcomes are three DISTINCT structured failures, each
 * naming what was expected against what was observed. `separations.md` §4b
 * makes all three fail the run; keeping them distinct is what lets a future
 * composition be selected on the difference (and is why legacy's single
 * `found:false` is the pattern this replaces).
 *
 * `retry` is deliberately absent. A search that answered `no-results` answered
 * correctly, and a `no-signal` re-run would burn the same silent window again;
 * a transient browser/session fault is the kernel's own retry surface.
 */
export const searchEmployeeTask = defineTask(newKronosDriver, NewKronosSearchEmployee, {
  sessions: [{ system: "new-kronos", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const read = await ctx.driver.searchEmployee({
      employeeId: input.emplId,
      searchTimeoutMs: input.searchTimeoutMs,
    });

    if (read.state === "no-signal") {
      return ctx.fail(
        "search-no-signal",
        `New Kronos employee search for EID ${directIdentifierDisplay(input.emplId)} produced neither a result row nor WFD's own `
        + `no-results sentinel within ${String(read.waitedMs)}ms (${read.reason}). The check could not run; `
        + "this is NOT evidence that the employee is absent from New Kronos.",
        { subject: input.emplId },
      );
    }
    if (read.state === "no-results") {
      return ctx.fail(
        "employee-not-found",
        `New Kronos employee search for EID ${directIdentifierDisplay(input.emplId)} returned WFD's own sentinel `
        + `${JSON.stringify(read.sentinel)} — expected one matching employee, observed none.`,
        { subject: input.emplId },
      );
    }
    if (read.state === "no-match") {
      const offered = read.candidates
        .map(({ employeeId }) => directIdentifierDisplay(employeeId))
        .join(", ");
      return ctx.fail(
        "search-returned-no-match",
        `New Kronos employee search for EID ${directIdentifierDisplay(input.emplId)} rendered ${String(read.totalCount)} row(s), `
        + `none of which is that employee — observed ids ${offered}.`,
        { subject: input.emplId },
      );
    }

    if (read.matched.employeeId !== input.emplId) {
      return ctx.fail(
        "unexpected-page-state",
        `New Kronos employee search matched row ${directIdentifierDisplay(read.matched.employeeId)} while resolving EID ${directIdentifierDisplay(input.emplId)}`,
        { subject: input.emplId },
      );
    }

    const output = SearchEmployeeOutputSchema.parse({
      query: read.query,
      totalCount: read.totalCount,
      candidates: read.candidates,
      matched: read.matched,
      selectedCount: read.selectedCount,
      panelContext: read.panelContext,
    });
    ctx.recordData([
      { direction: "read", field: "query", value: output.query },
      { direction: "read", field: "totalCount", value: output.totalCount },
      { direction: "read", field: "candidates", value: output.candidates },
      { direction: "read", field: "matched", value: output.matched },
      { direction: "read", field: "selectedCount", value: output.selectedCount },
      { direction: "read", field: "panelContext", value: output.panelContext },
    ]);
    return output;
  },
});
