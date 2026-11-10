import { descriptorSetHash } from "../../../src/backend/app/registries/workflow-registry.js";
import { CONTRACT_FINGERPRINT,FIXTURE_APP_VERSION,FIXTURE_NOW,WORKFLOW_ID } from "./fixture-identity.js";
import { createFixtureBootstrapSetup } from "../../support/helpers/dashboard/profiles/fixture-bootstrap-setup.js";

export const {
  FIXTURE_BOOTSTRAP
} = createFixtureBootstrapSetup( {
  bootstrapDescriptorHash: (CONTRACT_FINGERPRINT: string) => descriptorSetHash([CONTRACT_FINGERPRINT]),
  CONTRACT_FINGERPRINT,
  FIXTURE_APP_VERSION,
  FIXTURE_NOW,
  WORKFLOW_ID
});
