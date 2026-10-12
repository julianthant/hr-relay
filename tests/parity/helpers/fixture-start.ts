import { projectWorkflowStartSteps } from "../../../src/backend/runs/queries/bootstrap.js";
import {
WORKFLOW_MODULES,
} from "../../../src/backend/app/registries/workflow-registry.js";
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { CONFIG_FINGERPRINT,CONTRACT_FINGERPRINT,uuidOf,WORKFLOW_ID } from "./fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./fixture-queue.js";
import { createFixtureStartSetup } from "../../support/helpers/dashboard/profiles/fixture-start-setup.js";

export const {
  FIXTURE_START_PICKER_DESCRIPTOR_HASH,
  FIXTURE_START_PICKER_BOOTSTRAP,
  FIXTURE_START_PICKER_DAY_WIRE,
  FIXTURE_START_PLAN,
  FIXTURE_SEPARATIONS_START_PLAN
} = createFixtureStartSetup( {
  projectFixtureSteps: (module: (typeof WORKFLOW_MODULES)[number]) => projectWorkflowStartSteps(module.descriptor),
  FIXTURE_BOOTSTRAP,
  CONFIG_FINGERPRINT,
  CONTRACT_FINGERPRINT,
  uuidOf,
  WORKFLOW_ID,
  FIXTURE_DAY_WIRE
});
