import { z } from "zod";
import { wireError } from "./failure-status.js";

import type { DashboardApp } from "./api-types.js";
import type { IntakeRouteDeps } from "./intake-types.js";

export function registerIntakeRoutes(app: DashboardApp, deps: IntakeRouteDeps): void {
  // Upload bytes create the session outside command envelopes; identical digests join the existing session.
  app.post("/api/v1/intake/files", async (c) => {
    const workflow = z.string().min(1).parse(c.req.query("workflow"));
    const fileName = z.string().min(1).parse(c.req.query("filename"));
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const outcome = await deps.intake.upload({
      workflow,
      mediaType: c.req.header("content-type") ?? "",
      fileName,
      bytes,
    });
    if (outcome.state === "refused") {
      return c.json(wireError(`INTAKE_${outcome.code.toUpperCase().replaceAll("-", "_")}`, outcome.message, false), 422);
    }
    return c.json(outcome.session, outcome.state === "created" ? 201 : 200);
  });

  app.get("/api/v1/intake/:sessionId/commands/:commandId", c => {
    if (deps.intakeCommandResult === undefined) throw new Error("intake-command-result-unavailable");
    return c.json(deps.intakeCommandResult(c.req.param("sessionId"), c.req.param("commandId")));
  });
  app.get("/api/v1/intake/:sessionId", async (c) => c.json(await deps.intake.read(c.req.param("sessionId"))));

}
