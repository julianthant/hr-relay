// Build once in the main process before parallel workers serve the bundle.
import { ensureMockBundle } from "./bundle.js";
import { buildComponentFixtures } from "./component-fixtures.js";
import { setup, teardown } from "../../support/private-temp-setup.js";

export default async function mockGlobalSetup(): Promise<() => void> {
  await setup();
  ensureMockBundle();
  await buildComponentFixtures();
  return teardown;
}
