/**
 * Runs ONCE in Playwright's main process before any worker starts.
 *
 * The lane is parallel (`workers` > 1, `fullyParallel`), and every spec still
 * calls `ensureParityBundle()` in its own `beforeAll` so a file run in isolation
 * is honest. Without this hook, a stale `dist/dashboard` would have N workers
 * spawn N concurrent `web:build`s into the same directory. Building here means
 * each worker's own check finds the bundle already current and only proves it.
 *
 * Playwright requires a default export for `globalSetup`; it is the same
 * carve-out the config file itself has from the no-default-exports rule.
 */
import { ensureParityBundle } from "./bundle.js";

export default function parityGlobalSetup(): void {
  ensureParityBundle();
}
