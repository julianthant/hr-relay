/**
 * The server composition value for `separations`: the bundle-safe descriptor
 * plus every store its contracts name — `kuali` for the document read and the
 * finalization transaction, `ucpath` for the two identity reads and both UCPath
 * transactions, `new-kronos` for the timecard passage, and the pure
 * `separations` mini-store for all seven folds between them.
 *
 * Four stores in one module is the shape §3 predicted: the composition reuses
 * the TASKS the five sub-workflow descriptors made provable, and those
 * descriptors stay as the harnesses that proved them.
 */
import { defineWorkflowRole } from "../../domain/workflow/module-role.js";
import { kualiStore } from "../../stores/kuali/index.js";
import { newKronosStore } from "../../stores/new-kronos/index.js";
import { separationsStore } from "../../stores/separations/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";
import { separationsDescriptor } from "./descriptor.js";

export const separationsModule = Object.freeze({
  descriptor: separationsDescriptor,
  stores: Object.freeze([kualiStore, ucpathStore, newKronosStore, separationsStore]),
  // The composed graph the five separations chunk harnesses each prove a step
  // of — the `of` target every one of them names (D219).
  role: defineWorkflowRole({ kind: "composition" }),
});
