import { WorkerBrowserCommandRequestSchema } from "../../../rules/commands/commands.js";
import { CommandIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { WorkerCommandResultWireSchema, type WorkerCommandResultWire } from "../../../models/dashboard/worker-command-result.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

export function createWorkerCommandResultQuery(database: AuthorityDatabase) {
  return (commandId: string): WorkerCommandResultWire => {
    const id = CommandIdSchema.parse(commandId);
    return database.withAuthorityReadSnapshot(() => {
      const request = WorkerBrowserCommandRequestSchema.safeParse(database.authority.commands.get(id));
      if (!request.success || request.data.requestedBy !== LOCAL_OPERATOR_ACTOR_ID) return { state: "unavailable" };
      const audit = database.authority.commandAudits.findByCommand(id);
      if (audit === undefined) return { state: "unavailable" };
      if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(request.data)) throw new Error("worker-command-result-request-mismatch");
      return WorkerCommandResultWireSchema.parse({ state: "recorded", request: request.data, result: audit.result });
    });
  };
}
