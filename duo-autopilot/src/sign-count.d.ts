/**
 * Types for `sign-count.js`.
 *
 * The rule lives in plain JS because it is loaded by an MV3 service worker,
 * which has no build step. It is declared here so this repository's own unit
 * gate can import and pin it — the extension is a hard runtime dependency
 * (`assertDuoAutopilotReady` refuses to launch a browser without it), so its
 * one load-bearing arithmetic rule must be enforced by a test that actually
 * runs in `npm run test:coverage`, not only by the extension's offline lane.
 */
export declare function nextSignCount(storedCount: unknown, nowSec: unknown): number;
