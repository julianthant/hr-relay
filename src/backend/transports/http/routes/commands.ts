import { z } from "zod";
import { CommandIdSchema } from "../../../../rules/identity/ids.js";
import { CommandRefusal } from "../../../runs/commands/command-refusal.js";
import { BulkRunCommandRequestSchema, DashboardCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { createOperatorCommandIngress } from "../../../runs/commands/operator-command-ingress.js";
import { assertRequestActor } from "../request-identity.js";
import { MalformedCommandJsonError } from "./failure-status.js";

import type { HonoRequest } from "hono";
import type { DashboardApp } from "./api-types.js";
import type { CommandsRouteDeps } from "./commands-types.js";

const WorkerCommandPathSchema = z.strictObject({ commandId: CommandIdSchema });

async function readCommandJson(request: HonoRequest): Promise<unknown> {
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new MalformedCommandJsonError(cause);
  }
}

export function registerCommandsRoutes(app: DashboardApp, deps: CommandsRouteDeps): void {
  const operatorCommands = createOperatorCommandIngress({
    clock: deps.clock,
    journal: deps.commandJournal,
    protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    bulkAcceptances: deps.bulkCommandAcceptances,
    resolveIdentityGateAnswer: deps.resolveIdentityGateAnswer,
    resolveGateArmAnswer: deps.resolveGateArmAnswer,
  });

  app.post("/api/v1/commands", async (c) => {
    const body = await readCommandJson(c.req);
    const command = DashboardCommandRequestSchema.safeParse(body);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    const result = await operatorCommands.submit(body, async (accepted) => {
      try {
        const resolved = deps.resolveWriteCommand(accepted);
        await deps.intake.prepare(resolved);
        return await deps.commands.submit(resolved);
      } catch (error) {
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
    });
    const status = result.state === "conflict" ? 409 : result.state === "rejected" ? 422 : 200;
    return c.json(result, status);
  });


  // Outside /api/v1/commands/: a read must not cross the mutation ingress guard.
  app.get("/api/v1/worker-commands/:commandId", c => {
    const { commandId } = WorkerCommandPathSchema.parse(c.req.param());
    if (deps.workerCommandResult === undefined) throw new Error("worker-command-result-unavailable");
    return c.json(deps.workerCommandResult(commandId));
  });

  app.post("/api/v1/commands/bulk", async (c) => {
    const body = await readCommandJson(c.req);
    const command = BulkRunCommandRequestSchema.safeParse(body);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    const result = await operatorCommands.executeBulk(
      body,
      (accepted) => deps.commands.executeBulk(accepted),
    );
    return c.json(result, result.state === "refused" ? 422 : 200);
  });

}
