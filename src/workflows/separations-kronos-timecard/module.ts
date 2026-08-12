import { newKronosStore } from "../../stores/new-kronos/index.js";
import { separationsKronosTimecardDescriptor } from "./descriptor.js";

/**
 * The server composition value: the bundle-safe descriptor plus the concrete
 * stores its contracts resolve through. One store, because this chunk touches
 * exactly one system — which is the point of proving it alone.
 */
export const separationsKronosTimecardModule = Object.freeze({
  descriptor: separationsKronosTimecardDescriptor,
  stores: Object.freeze([newKronosStore]),
});
