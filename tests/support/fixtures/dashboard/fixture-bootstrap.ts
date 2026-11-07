import { at,CONTRACT_FINGERPRINT,FIXTURE_APP_VERSION,FIXTURE_DESCRIPTOR_HASH,FIXTURE_NOW,WORKFLOW_ID } from "./fixture-identity.js";
import { createFixtureBootstrapSetup } from "../../helpers/dashboard/profiles/fixture-bootstrap-setup.js";

export const {
  FIXTURE_BOOTSTRAP
} = createFixtureBootstrapSetup( {
  bootstrapDescriptorHash: () => FIXTURE_DESCRIPTOR_HASH,
  at,
  CONTRACT_FINGERPRINT,
  FIXTURE_APP_VERSION,
  FIXTURE_NOW,
  WORKFLOW_ID
});
