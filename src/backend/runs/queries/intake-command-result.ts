import { IntakeCommandRequestSchema } from "../../../rules/commands/commands.js";
import { CommandIdSchema, IntakeSessionIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { IntakeCommandResultWireSchema, type IntakeCommandResultWire } from "../../../models/dashboard/workbooks.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

export function createIntakeCommandResultQuery(database: AuthorityDatabase) {
  return (sessionId: string, commandId: string): IntakeCommandResultWire => {
    const session = IntakeSessionIdSchema.parse(sessionId), id = CommandIdSchema.parse(commandId);
    return database.withAuthorityReadSnapshot(() => {
      const stored = database.authority.commands.get(id);
      const request = IntakeCommandRequestSchema.safeParse(stored);
      if (!request.success || request.data.requestedBy !== LOCAL_OPERATOR_ACTOR_ID
        || request.data.target.intakeSessionId !== session) return { state: "unavailable" };
      const audit = database.authority.commandAudits.findByCommand(id);
      if (audit === undefined) return { state: "unavailable" };
      if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(request.data)) throw new Error("intake-command-result-request-mismatch");
      return IntakeCommandResultWireSchema.parse({ state: "recorded", request: request.data, result: audit.result });
    });
  };
}
