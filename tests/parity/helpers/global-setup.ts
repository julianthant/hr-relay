// Build once in the main process before parallel workers serve the bundle.
import { ensureParityBundle } from "./bundle.js";
import { buildComponentFixtures } from "./component-fixtures.js";
import { setup, teardown } from "../../support/private-temp-setup.js";

export default async function parityGlobalSetup(): Promise<() => void> {
  await setup();
  ensureParityBundle();
  await buildComponentFixtures();
  return teardown;
}
