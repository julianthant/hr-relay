import { buildFixtureIdentityGate } from "../fixture-gate.js";
import { at,uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { createGatesParkSetup } from "../../../helpers/dashboard/profiles/run-detail/gates-park-setup.js";

const {
  PARKED_WRITE_INTENT,
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

export { FIXTURE_IDENTITY_GATE, FIXTURE_IDENTITY_GATE_NAME_MISMATCH, FIXTURE_PARKED_WRITE, FIXTURE_GATE_PARK_SECTIONS };
export { PARKED_WRITE_INTENT as FIXTURE_PARKED_WRITE_INTENT };
