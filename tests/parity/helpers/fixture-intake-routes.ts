import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../src/models/intake/wire.js";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { redactValue } from "../../../src/rules/redaction/redaction.js";
import { createFixtureIntakeRoutesSetup } from "../../support/helpers/dashboard/profiles/fixture-intake-routes-setup.js";

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

export const {
  registerFixtureIntakeRoutes
} = createFixtureIntakeRoutesSetup( {
  presentFixtureSession: fixtureIntakePresentation
});
