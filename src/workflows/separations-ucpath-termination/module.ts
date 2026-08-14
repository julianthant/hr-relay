/**
 * The server composition value for `separations-ucpath-termination`: the
 * bundle-safe descriptor plus the two stores that implement every contract it
 * names — `ucpath` for the reads and both transactions, and the pure
 * `separations` mini-store for the two folds (identity match, §4a's map).
 */
import { separationsStore } from "../../stores/separations/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";
import { separationsUcpathTerminationDescriptor } from "./descriptor.js";

export const separationsUcpathTerminationModule = Object.freeze({
  descriptor: separationsUcpathTerminationDescriptor,
  stores: Object.freeze([ucpathStore, separationsStore]),
});
