import { MOCK_WORKFLOW_CATALOG } from "../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { createFixtureIdentitySetup } from "../../support/helpers/dashboard/profiles/fixture-identity-setup.js";

export const {
  uuidOf,
  traceOf,
  FIXTURE_DAY,
  FIXTURE_NOW,
  FIXTURE_APP_VERSION,
  CONTRACT_FINGERPRINT,
  FIXTURE_DESCRIPTOR_HASH,
  CONFIG_FINGERPRINT,
  WORKFLOW_ID,
  at
} = createFixtureIdentitySetup( {
  descriptorHash: () => MOCK_WORKFLOW_CATALOG.descriptorSetHash
});
