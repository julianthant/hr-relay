// Build once in the main process before parallel workers serve the bundle.
import { ensureParityBundle } from "./bundle.js";

export default function parityGlobalSetup(): void {
  ensureParityBundle();
}
