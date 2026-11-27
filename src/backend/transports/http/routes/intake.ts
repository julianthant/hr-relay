import { z } from "zod";
import { CommandIdSchema, IntakeSessionIdSchema } from "../../../../rules/identity/ids.js";
import type { DashboardApp } from "./api-types.js";
import type { IntakeRouteDeps } from "./intake-types.js";

const SessionPathSchema = z.strictObject({ sessionId: IntakeSessionIdSchema });
const CommandResultPathSchema = SessionPathSchema.extend({ commandId: CommandIdSchema });

export function registerIntakeRoutes(app: DashboardApp, deps: IntakeRouteDeps): void {
  app.get("/api/v1/intake/:sessionId/commands/:commandId", c => {
    const { sessionId, commandId } = CommandResultPathSchema.parse(c.req.param());
    if (deps.intakeCommandResult === undefined) throw new Error("intake-command-result-unavailable");
    return c.json(deps.intakeCommandResult(sessionId, commandId));
  });
  app.get("/api/v1/intake/:sessionId", async (c) => {
    const { sessionId } = SessionPathSchema.parse(c.req.param());
    return c.json(await deps.intake.read(sessionId));
  });

}
