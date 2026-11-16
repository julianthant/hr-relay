import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createFixtureIdentitySetup } from "../../helpers/dashboard/profiles/fixture-identity-setup.js";

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
  descriptorHash: (CONTRACT_FINGERPRINT: string) => descriptorSetHash([CONTRACT_FINGERPRINT])
});
