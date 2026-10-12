import { createFixtureIntakeRoutesSetup } from "../profiles/fixture-intake-routes-setup.js";

export const {
  registerFixtureIntakeRoutes
} = createFixtureIntakeRoutesSetup( {
  presentFixtureSession: (session) => session
});
