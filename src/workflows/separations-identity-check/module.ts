import { defineWorkflowRole } from "../../domain/workflow/module-role.js";
import { separationsStore } from "../../stores/separations/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";
import { separationsIdentityCheckDescriptor } from "./descriptor.js";

/**
 * The server composition value. Two stores: the UCPath browser store for both
 * page visits, and the `separations` pure mini-store for the comparison fold and
 * the post-gate check — the second contributes no browser session by
 * construction, which is what lets the run park at the gate owning nothing.
 */
export const separationsIdentityCheckModule = Object.freeze({
  descriptor: separationsIdentityCheckDescriptor,
  stores: Object.freeze([ucpathStore, separationsStore]),
  // A proving harness for one step of `separations`, never a peer workflow (D219).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations" }),
});
