import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../src/models/intake/wire.js";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { redactValue } from "../../../src/rules/redaction/redaction.js";
import { wireError } from "../../support/fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import { FIXTURE_INTAKE_MAPPING,FIXTURE_INTAKE_SESSIONS } from "../../support/fixtures/dashboard/fixture-intake.js";
export function fixtureIntakePresentation(session: IntakeSessionWire): IntakeSessionWire {
  if (session.validation.state !== "validated") return session;
  const rejected = session.validation.rejected.map(reject => {
    if ((reject.kind !== "cell-coercion" && reject.kind !== "field-schema") || reject.raw.state !== "allowed") return reject;
    const binding = session.bindings.find(item => item.targetFieldId === reject.field);
    const field = Object.values(CANONICAL_FIELDS).find(item => item.id === binding?.canonicalFieldId);
    if (!field) throw new Error(`INTAKE_MOCK_FIELD_POLICY_MISSING: ${reject.field}`);
    return { ...reject, raw: redactValue(field.classification, field.redactTransform, reject.raw.value) };
  });
  return IntakeSessionWireSchema.parse({ ...session, validation: { ...session.validation, rejected } });
}

export function registerFixtureIntakeRoutes({ app }: { app: Hono }): void {



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
    return c.json(fixtureIntakePresentation(session) as unknown);
  });
}
