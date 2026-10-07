import { wireError } from "../../../../../support/fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import { FIXTURE_INTAKE_MAPPING,FIXTURE_INTAKE_SESSIONS } from "../../../../../support/fixtures/dashboard/fixture-intake.js";
export function registerFixtureIntakeRoutes({ app }: { app: Hono }): void {


  /**
   * The intake pair (2i-E3). The upload answers `201` with the mid-mapping
   * session, which is what a real first upload of these bytes returns — the
   * status is the contract here, so serving `200` would have the app report a
   * JOINED session for a file it had never seen.
   */
  app.post("/api/v1/intake/files", (c) => {
    const fileName = c.req.query("filename");
    if (fileName === undefined || fileName.length === 0) {
      return c.json(wireError("SCHEMA_INVALID", "the intake upload route requires ?filename="), 400);
    }
    return c.json(FIXTURE_INTAKE_MAPPING as unknown, 201);
  });


  app.get("/api/v1/intake/:sessionId", (c) => {
    const session = FIXTURE_INTAKE_SESSIONS[c.req.param("sessionId")];
    if (session === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture intake session ${c.req.param("sessionId")}`), 404);
    }
    return c.json(session as unknown);
  });
}
