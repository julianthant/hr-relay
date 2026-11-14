import { buildFixtureIdentityGate } from "../fixture-gate.js";
import { at,uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { createGatesParkSetup } from "../../../support/helpers/dashboard/profiles/run-detail/gates-park-setup.js";

export const {
  FIXTURE_IDENTITY_GATE,
  FIXTURE_IDENTITY_GATE_NAME_MISMATCH,
  FIXTURE_PARKED_WRITE,
  FIXTURE_GATE_PARK_SECTIONS
} = createGatesParkSetup( {
  buildFixtureIdentityGate,
  at,
  uuidOf,
  FIXTURE_IDS
});
