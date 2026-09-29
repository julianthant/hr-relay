import { BulkRunCommandRequestSchema, CommandRequestSchema, ProviderKeysRetryIntentSchema } from "../../../domain/commands.js";
import { createOperatorCommandIngress } from "../commands/operator-command-ingress.js";
import { assertRequestActor } from "../request-identity.js";

import type { DashboardApp } from "./api-types.js";
import type { CommandsRouteDeps } from "./commands-types.js";

export function registerCommandsRoutes(app: DashboardApp, deps: CommandsRouteDeps): void {
  const operatorCommands = createOperatorCommandIngress({
    clock: deps.clock,
    journal: deps.commandJournal,
    protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    readPendingProviderRequest: deps.readPendingProviderRequest,
    providerCommandAcceptedAt: deps.providerCommandAcceptedAt,
    runtimeVersionAcceptedAt: deps.runtimeVersionAcceptedAt,
    bulkAcceptances: deps.bulkCommandAcceptances,
  });

  app.post("/api/v1/commands", async (c) => {
    const body: unknown = await c.req.json();
    const command = CommandRequestSchema.safeParse(body);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    const retry = ProviderKeysRetryIntentSchema.safeParse(body);
    if (retry.success) assertRequestActor(c.get("requestActorId"), retry.data.requestedBy);
    const result = await operatorCommands.submit(body, async (accepted) => {
      // Warm the seams a synchronous authority transaction cannot await. Today
      // that is exactly the intake parse (D170); every other family is a no-op.
      await deps.intake.prepare(accepted);
      // Pool controls and start-triggered worker capacity await durable process
      // evidence; every authority transition still uses the same kernel.
      return deps.commands.submit(accepted);
    });
    const status = result.state === "conflict" ? 409 : result.state === "rejected" ? 422 : 200;
    return c.json(result, status);
  });

  /**
   * D235 — the bulk door. It is a SECOND route rather than a mode of the one
   * above because the two answer different shapes: one command answers one
   * `CommandResult`, and N commands answer N of them. Folding a vector into the
   * single-result union would have made every existing consumer parse a shape
   * it can never receive, and would have given the collapse-into-"Done" defect
   * a place to hide.
   *
   * No `intake.prepare` warm-up: the bulk vocabulary is the three run verbs,
   * none of which reaches an async seam.
   */
  app.post("/api/v1/commands/bulk", async (c) => {
    const body: unknown = await c.req.json();
    const command = BulkRunCommandRequestSchema.safeParse(body);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    const result = await operatorCommands.executeBulk(
      body,
      (accepted) => deps.commands.executeBulk(accepted),
    );
    return c.json(result, result.state === "refused" ? 422 : 200);
  });

}
