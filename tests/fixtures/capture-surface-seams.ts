/**
 * The unwired capture seam, for BFF harnesses that exercise other surfaces
 * (2i-F, D174).
 *
 * It mirrors `UNWIRED_INTAKE_SERVICE`: every method THROWS by name rather than
 * returning an empty session, so a harness that accidentally routes a capture
 * request fails loudly instead of proving a capture surface nobody composed.
 * The type annotation is what keeps it honest — adding a method to
 * `CaptureService` breaks this file until it is filled in.
 */
import type { CaptureService } from "../../src/server/dashboard/commands/capture-service.js";

function unwired(): never {
  throw new Error("this dashboard wires no capture service");
}

export const UNWIRED_CAPTURE_SERVICE: CaptureService = Object.freeze({
  start: unwired,
  readOperatorSession: unwired,
  listOperatorSessions: unwired,
  readByToken: unwired,
  uploadPhoto: unwired,
  replacePhoto: unwired,
  readPhotoBytes: unwired,
  deletePhoto: unwired,
  reorder: unwired,
  finalize: unwired,
  retryFinalize: unwired,
  discard: unwired,
  drainFinalizations: unwired,
});
