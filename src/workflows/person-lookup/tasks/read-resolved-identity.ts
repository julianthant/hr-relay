import { defineTask } from "../../../workflow-kit/task.js";
import { ReadResolvedIdentity } from "../../../models/workflows/person-lookup/read-resolved-identity.js";

import { resolvePersonLookupIdentity } from "../../../rules/matching/person-lookup.js";
import type { DataPoint } from "../../../rules/workflow/task-provenance.js";
export const readResolvedIdentityTask = defineTask(ReadResolvedIdentity, {
  sessions: [],
  async run({ input, ctx }) {
    const output = resolvePersonLookupIdentity(input);
    ctx.log.info("Identity cross-check", { method: output.method, candidates: output.candidateEids.length });
    const aliases = new Map<string, NonNullable<DataPoint["aliases"]>>();
    if (output.selected !== null) {
      const index = input.person?.results.indexOf(output.selected) ?? -1;
      // Match mode reads no UCPath person: one it resolves over is the UCPath identity's own selected person.
      const source = input.input.mode === "match" ? { nodeId: "search-identity", path: ["selected"] }
        : { nodeId: "searching", path: output.selected === input.person?.selection.selected ? ["selection", "selected"] : index < 0 ? undefined : ["results", index] };
      if (source.path === undefined || input.input.mode === "match" && output.selected !== input.person?.selection.selected) throw new Error("observation alias selected dependency unavailable");
      aliases.set("selected", [{ path: [], source: { kind: "dependency", nodeId: source.nodeId, path: source.path } }]);
    }
    if (input.crm?.state === "checked") {
      if (output.crmRecord !== null) {
        const index = input.crm.records.indexOf(output.crmRecord);
        if (index < 0) throw new Error("observation alias CRM dependency unavailable");
        aliases.set("crmRecord", [{ path: [], source: { kind: "dependency", nodeId: "cross-verify", path: ["records", index] } }]);
        if (output.crmIdentity !== null) aliases.set("crmIdentity", Object.keys(output.crmIdentity).map(field => ({ path: [field], source: { kind: "dependency" as const, nodeId: "cross-verify", path: ["records", index, field] } })));
      }
      if (output.unselectedCrmRecords === input.crm.records) aliases.set("unselectedCrmRecords", [{ path: [], source: { kind: "dependency", nodeId: "cross-verify", path: ["records"] } }]);
    }
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value,
      ...(aliases.has(field) ? { aliases: aliases.get(field) } : {}) })));
    return output;
  },
});
