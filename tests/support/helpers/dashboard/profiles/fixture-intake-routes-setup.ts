import { FIXTURE_INTAKE_SESSIONS } from "../../../fixtures/dashboard/fixture-intake.js";
import { wireError } from "../../../fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import type * as WireTypes from "../../../../../src/models/intake/wire.js";


export function createFixtureIntakeRoutesSetup({ presentFixtureSession }: {
presentFixtureSession: (session: WireTypes.IntakeSessionWire) => WireTypes.IntakeSessionWire;
}) {
  function registerFixtureIntakeRoutes({ app }: { app: Hono }): void {



    app.get("/api/v1/intake/:sessionId", (c) => {
      const session = FIXTURE_INTAKE_SESSIONS[c.req.param("sessionId")];
      if (session === undefined) {
        return c.json(wireError("TARGET_NOT_FOUND", `no fixture intake session ${c.req.param("sessionId")}`), 404);
      }
      return c.json(presentFixtureSession(session) as unknown);
    });
  }

  return { registerFixtureIntakeRoutes };
}
