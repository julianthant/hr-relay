import { defineTask } from "../../../base/task.js";
import {
  MatchTerminationTypeOutputSchema,
  SeparationsMatchTerminationType,
} from "../../../domain/contracts/separations/match-termination-type.js";
import {
  auditTerminationTypeOptionList,
  resolveTerminationType,
} from "../../../domain/separations/termination-type.js";

/**
 * §4a's refusal, executed. Nothing here decides anything — the map does — and
 * that is deliberate: this file's whole job is to turn the pure resolution into
 * a run outcome with the right durable code.
 *
 * The ORDER matters. The option-list drift check runs BEFORE the lookup,
 * because a control that has been republished makes every answer from the map
 * suspect, including the ones that still happen to match. A run that resolved
 * `Retirement` correctly off a control that has grown three new options has not
 * proved anything about the other two.
 */
export const matchTerminationTypeTask = defineTask(SeparationsMatchTerminationType, {
  sessions: [],
  async run({ input, ctx }) {
    const drift = auditTerminationTypeOptionList(input.observedOptions);
    if (drift.state === "drifted") {
      return ctx.fail(
        "termination-type-options-drifted",
        `Kuali document ${input.documentNumber} rendered a Type of Termination control that no longer `
        + "matches the option list captured live on 2026-08-12"
        + (drift.added.length > 0 ? ` — added ${JSON.stringify(drift.added)}` : "")
        + (drift.removed.length > 0 ? ` — removed ${JSON.stringify(drift.removed)}` : "")
        + (drift.reordered ? " — the same options in a different order" : "")
        + ". §4a's map is exhaustive over the captured list, so a republished control means the "
        + "template/reason-code mapping has to be reviewed before any termination is filed from it.",
      );
    }

    if (input.terminationType.state === "absent") {
      return ctx.fail(
        "blank-termination-type",
        `Kuali document ${input.documentNumber} has no Type of Termination selected `
        + `(${input.terminationType.reason}). Legacy would classify this VOLUNTARY and file `
        + "`Resign - No Reason Given`; there is no default arm here.",
      );
    }

    const resolution = resolveTerminationType(input.terminationType.value);
    if (resolution.state === "refused") {
      return ctx.fail(
        resolution.code,
        `Kuali document ${input.documentNumber}: ${resolution.reason} Legacy resolves this through a `
        + "bidirectional substring match and then the constant `Resign - No Reason Given` — the tier that "
        + "makes a Kuali type of \"Other\" file as *Accepted Another Job*, because \"accepted an**other** "
        + "job\" contains \"other\". Neither tier ports, and there is no default arm.",
      );
    }

    const output = MatchTerminationTypeOutputSchema.parse({
      terminationType: resolution.terminationType,
      classification: resolution.classification,
      template: resolution.template,
      reasonCode: resolution.reasonCode,
      observedOptionCount: input.observedOptions.length,
    });
    ctx.recordData([
      { direction: "read", field: "terminationType", value: output.terminationType },
      { direction: "read", field: "classification", value: output.classification },
      { direction: "read", field: "template", value: output.template },
      { direction: "read", field: "reasonCode", value: output.reasonCode },
      { direction: "read", field: "observedOptionCount", value: output.observedOptionCount },
    ]);
    return output;
  },
});
