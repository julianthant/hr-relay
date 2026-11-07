import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import type { RunDetailSectionResponse } from "../../../../../src/models/dashboard/run-detail.js";

export function sectionResponse(value: unknown): RunDetailSectionResponse {
  return RunDetailSectionResponseSchema.parse(value);
}
