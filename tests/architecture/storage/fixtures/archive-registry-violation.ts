/**
 * The violating fixture for `archive-invariants` — a module that reaches the
 * workflow registry two hops from its entry, exactly the way a real regression
 * would (an innocuous-looking helper import, not a direct one).
 *
 * It exists so the closure walker has something it MUST catch. A structural
 * check that only ever runs against compliant code is indistinguishable from
 * a check that resolves nothing at all.
 */
export { descriptorRuntimeNodes } from "./archive-registry-violation-hop.js";
