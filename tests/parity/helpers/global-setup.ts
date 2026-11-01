// Build once in the main process before parallel workers serve the bundle.
import { ensureParityBundle } from "./bundle.js";
import { buildComponentFixtures } from "./component-fixtures.js";

export default async function parityGlobalSetup(): Promise<void> {
  ensureParityBundle();
  await buildComponentFixtures();
}
