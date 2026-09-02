/**
 * D307 — omitting the Kronos timecard step.
 *
 * The operator types the last day worked and the separation date; the step's
 * one pure fold (`dates`) is rebuilt from them over the plan the Kuali read
 * produced. The two browser reads (`timecard-search`, `timecard`) are simply
 * not run — nothing downstream reads them except this fold — and the
 * rebuilt dates say so in their own leaves (no leave, no pay codes, a comment
 * that cites operator entry, never a timesheet).
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../../../domain/canonical-json.js";
import { ReadSeparationPlanOutputSchema } from "../../../domain/contracts/separations/read-separation-plan.js";
import { assertSeparationDates } from "../../../domain/separations/separation-dates.js";
import type { StepOmissionDeclaration } from "../../../domain/workflow/step-omission.js";
import { DATES_NODE } from "./node-ids.js";
import { PLAN_NODE } from "../kuali-extraction/node-ids.js";

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FactsSchema = z.strictObject({
  lastDayWorked: z.string().min(1),
  separationDate: z.string().min(1),
});

export const KRONOS_TIMECARD_OMISSION: StepOmissionDeclaration = {
  form: {
    fields: [
      {
        key: "lastDayWorked", label: "Last day worked", kind: "us-date",
        help: "The employee's last physical day of work, MM/DD/YYYY. Kronos is not read; this stands in for the card's last punch.",
      },
      {
        key: "separationDate", label: "Separation date", kind: "us-date",
        help: "The last day on pay status, MM/DD/YYYY — the same day as the last day worked unless paid leave follows it. The termination is effective the next day.",
      },
    ],
  },
  produces: {
    [DATES_NODE]: ({ facts, scope }) => {
      const typed = FactsSchema.parse(facts);
      const plan = ReadSeparationPlanOutputSchema.parse(scope.outputs[PLAN_NODE]);
      if (!isJsonObject(scope.input)) {
        throw new Error("kronos-timecard omission requires the run's canonical input object to read the timekeeper name");
      }
      const timekeeperName = scope.input.timekeeperName;
      if (typeof timekeeperName !== "string" || timekeeperName.length === 0) {
        throw new Error("kronos-timecard omission requires input.timekeeperName to be a non-empty string");
      }
      return assertSeparationDates({
        plan,
        timekeeperName,
        lastDayWorked: typed.lastDayWorked,
        separationDate: typed.separationDate,
      });
    },
  },
};
