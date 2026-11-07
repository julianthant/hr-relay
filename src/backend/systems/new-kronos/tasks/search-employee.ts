import { defineTask } from "../../../../workflow-kit/task.js";
import {
  NewKronosSearchEmployee,
  SearchEmployeeOutputSchema,
} from "../../../../models/systems/new-kronos/search-employee.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { newKronosDriver } from "../driver-declaration.js";


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
