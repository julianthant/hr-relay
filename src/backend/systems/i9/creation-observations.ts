import type { z } from "zod";
import type { I9ProfileVerdictSchema, I9RemoteVerdictSchema } from "../../../models/ui/i9-creation.js";
import type { DataPoint } from "../../../rules/workflow/task-provenance.js";

export function i9CreationObservations(output: z.infer<typeof I9ProfileVerdictSchema> | z.infer<typeof I9RemoteVerdictSchema>): DataPoint[] {
  const state: DataPoint = { direction: "read", field: "state", value: output.state };
  switch (output.state) {
    case "present": return [state, { direction: "read", field: "proof", value: output.proof }];
    case "absent": return [state, { direction: "read", field: "evidence", value: output.evidence }];
    case "unknown": return [state, { direction: "read", field: "reason", value: output.reason },
      { direction: "read", field: "observedAt", value: output.observedAt }];
    case "ambiguous": return [state, { direction: "read", field: "matches", value: output.matches },
      { direction: "read", field: "observedAt", value: output.observedAt },
      { direction: "read", field: "queryDigest", value: output.queryDigest },
      { direction: "read", field: "evidence", value: output.evidence }];
  }
}
