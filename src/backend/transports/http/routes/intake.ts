import { z } from "zod";
import { CommandIdSchema, IntakeSessionIdSchema, WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { INTAKE_UPLOAD_MAX_BYTES, INTAKE_UPLOAD_SIZE_MESSAGE } from "../../../runs/commands/intake-service.js";
import { readBoundedUpload } from "./bounded-upload.js";
import { wireError } from "./failure-status.js";
import { rawRouteQuery } from "./request-parameters.js";

import type { DashboardApp } from "./api-types.js";
import type { IntakeRouteDeps } from "./intake-types.js";

const UploadQuerySchema = z.strictObject({
  workflow: WorkflowIdSchema,
  filename: z.string().min(1).max(255),
});
const SessionPathSchema = z.strictObject({ sessionId: IntakeSessionIdSchema });
const CommandResultPathSchema = SessionPathSchema.extend({ commandId: CommandIdSchema });

export function registerIntakeRoutes(app: DashboardApp, deps: IntakeRouteDeps): void {
  // Upload bytes create the session outside command envelopes; identical digests join the existing session.
  app.post("/api/v1/intake/files", async (c) => {
    const { workflow, filename: fileName } = UploadQuerySchema.parse(rawRouteQuery(c.req.url));
    const bytes = await readBoundedUpload(c.req.raw.body, INTAKE_UPLOAD_MAX_BYTES);
    if (bytes === undefined) return c.json(wireError("SCHEMA_INVALID", INTAKE_UPLOAD_SIZE_MESSAGE, false), 400);
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
    const { sessionId, commandId } = CommandResultPathSchema.parse(c.req.param());
    if (deps.intakeCommandResult === undefined) throw new Error("intake-command-result-unavailable");
    return c.json(deps.intakeCommandResult(sessionId, commandId));
  });
  app.get("/api/v1/intake/:sessionId", async (c) => {
    const { sessionId } = SessionPathSchema.parse(c.req.param());
    return c.json(await deps.intake.read(sessionId));
  });

}
