/**
 * The server composition value for kuali-timekeeper-annotation: the bundle-safe
 * descriptor plus the one store that implements every contract it names.
 *
 * The registry verifies at boot that each of the four Kuali contracts — probe,
 * verifier, prepare, commit — resolves through this exact factory-defined store
 * and that no other store is listed.
 */
import { defineWorkflowRole } from "../../domain/workflow/module-role.js";
import { kualiStore } from "../../stores/kuali/index.js";
import { kualiTimekeeperAnnotationDescriptor } from "./descriptor.js";

export const kualiTimekeeperAnnotationModule = Object.freeze({
  descriptor: kualiTimekeeperAnnotationDescriptor,
  stores: Object.freeze([kualiStore]),
  // The one-transaction-node workflow that carried D135's controlled-commit
  // proof. It proves kernel machinery rather than doing daily HR work, so the
  // rail drops it while the picker and the Explorer keep it startable and
  // documented (D220 — the operator's 2026-08-14 call).
  role: defineWorkflowRole({ kind: "proving" }),
});
